"""Email Bridge adapter: poll an IMAP mailbox for new mail → capture items.

Read-only by design: the mailbox is selected read-only and fetches use
``BODY.PEEK[]``, so polling never marks messages seen and never moves or
deletes anything. ``imaplib`` is synchronous, so every network call runs off
the event loop via :func:`asyncio.to_thread`. Each message is normalized
into an :class:`EmailItem` with a stable ``external_id`` (Message-ID when
present, folder UID otherwise) so capture ingress deduplicates retries.
"""

from __future__ import annotations

import asyncio
import email
import email.header
import email.utils
import imaplib
import logging
import re
import ssl
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from html.parser import HTMLParser
from typing import Any, Protocol

logger = logging.getLogger(__name__)

_MAX_BODY_CHARS = 2000
_MAX_SUBJECT_CHARS = 300
# The body is clipped to _MAX_BODY_CHARS afterwards, so the HTML fallback
# never needs more than this much markup. The cap bounds its cost on the
# event loop even for hostile mail.
_MAX_HTML_CHARS = 256_000
_BLOCK_END_TAGS = frozenset({"p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"})
_SKIPPED_TAGS = frozenset({"script", "style"})
_IMAP_DATE_FMT = "%d-%b-%Y"


class EmailError(RuntimeError):
    """Raised for IMAP connection/auth/fetch failures."""


class _ImapConnection(Protocol):
    """The slice of imaplib.IMAP4 the adapter uses (enables fakes in tests)."""

    def login(self, user: str, password: str) -> tuple[str, list[Any]]: ...

    def select(self, mailbox: str, readonly: bool) -> tuple[str, list[Any]]: ...

    def uid(self, command: str, *args: str) -> tuple[str, list[Any]]: ...

    def logout(self) -> tuple[str, list[Any]]: ...


@dataclass
class EmailItem:
    """One fetched message, normalized for capture ingress."""

    uid: int
    message_id: str
    subject: str
    sender: str
    date: str  # ISO 8601 (best-effort parsed; raw header fallback)
    body: str
    folder: str = "INBOX"
    labels: list[str] = field(default_factory=list)

    @property
    def external_id(self) -> str:
        if self.message_id:
            return f"email:mid:{self.message_id}"
        return f"email:uid:{self.folder}:{self.uid}"

    def to_capture_markdown(self) -> str:
        """Render the message as the capture's markdown body."""
        lines = [f"## Email — {self.subject or '(no subject)'}", ""]
        if self.body:
            lines.append(self.body)
            lines.append("")
        lines.extend(
            [
                f"- From: {self.sender or 'unknown'}",
                f"- Date: {self.date or 'unknown'}",
                f"- Mailbox: {self.folder}",
            ]
        )
        return "\n".join(lines) + "\n"

    def provenance(self) -> dict[str, Any]:
        """Structured metadata stored alongside the capture."""
        return {
            "email": self.sender,
            "folder": self.folder,
            "message_id": self.message_id,
            "imap_uid": self.uid,
            "date": self.date,
        }


def _decode_header_value(raw: str | None) -> str:
    """Decode an RFC 2047 encoded header value to plain text."""
    if not raw:
        return ""
    try:
        return str(email.header.make_header(email.header.decode_header(raw)))
    except (email.errors.HeaderParseError, ValueError, LookupError):
        return raw


def _clip(text: str, limit: int) -> str:
    text = (text or "").strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _decode_payload(part: email.message.Message) -> str:
    payload = part.get_payload(decode=True)
    if payload is None:
        raw = part.get_payload()
        return raw if isinstance(raw, str) else ""
    if not isinstance(payload, bytes):
        return str(payload)
    charset = part.get_content_charset() or "utf-8"
    try:
        return payload.decode(charset, errors="replace")
    except (LookupError, UnicodeDecodeError):
        return payload.decode("utf-8", errors="replace")


class _HtmlText(HTMLParser):
    """Collect an HTML document's visible text in one linear pass."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _SKIPPED_TAGS:
            self._skip_depth += 1
        elif tag == "br":
            self.parts.append("\n")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "br":
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIPPED_TAGS:
            self._skip_depth = max(0, self._skip_depth - 1)
        elif tag in _BLOCK_END_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._skip_depth:
            self.parts.append(data)


def _strip_html(markup: str) -> str:
    """Dependency-free HTML→text: block tags become newlines, the rest drop
    silently, script/style content is removed, entities resolve, whitespace
    collapses.

    Uses a streaming parser rather than regexes: this runs on untrusted mail,
    and backtracking regexes took minutes on a few KB of unclosed tags.
    """
    parser = _HtmlText()
    parser.feed(markup[:_MAX_HTML_CHARS])
    parser.close()
    text = "".join(parser.parts)
    lines = [re.sub(r"[ \t\xa0]+", " ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line).strip()


def _extract_body(msg: email.message.Message) -> str:
    """Prefer text/plain; fall back to stripped text/html. Attachments ignored."""
    plain: str | None = None
    html: str | None = None
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_disposition() == "attachment":
                continue
            ctype = part.get_content_type()
            if ctype == "text/plain" and plain is None:
                plain = _decode_payload(part)
            elif ctype == "text/html" and html is None:
                html = _decode_payload(part)
    else:
        ctype = msg.get_content_type()
        if ctype == "text/plain":
            plain = _decode_payload(msg)
        elif ctype == "text/html":
            html = _decode_payload(msg)
    if plain and plain.strip():
        return plain.strip()
    if html:
        return _strip_html(html)
    return ""


def _parse_date(raw: str | None) -> str:
    if not raw:
        return ""
    try:
        parsed = email.utils.parsedate_to_datetime(raw)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed.isoformat()
    except (TypeError, ValueError):
        return raw.strip()


def _imap_ssl(host: str, port: int) -> imaplib.IMAP4_SSL:
    """Open IMAP over TLS, verifying the server certificate and hostname.

    ``imaplib.IMAP4_SSL`` without an explicit context falls back to
    ``ssl._create_stdlib_context()``, which checks neither, so anyone on the
    network path could impersonate the server and read the login.
    """
    return imaplib.IMAP4_SSL(host, port, ssl_context=ssl.create_default_context())


class EmailClient:
    """Async facade over a synchronous IMAP connection.

    ``imap_factory`` is injectable for tests; it must produce an object
    satisfying :class:`_ImapConnection` given (host, port).
    """

    def __init__(
        self,
        host: str,
        port: int,
        username: str,
        password: str,
        *,
        use_ssl: bool = True,
        imap_factory: Callable[[str, int], _ImapConnection] | None = None,
    ) -> None:
        self._host = host
        self._port = port
        self._username = username
        self._password = password
        if imap_factory is not None:
            self._factory = imap_factory
        elif use_ssl:
            self._factory = _imap_ssl
        else:
            self._factory = imaplib.IMAP4
        self._conn: _ImapConnection | None = None
        # UIDVALIDITY of the folder last opened by fetch_since ("" if the
        # server did not report one). Stored alongside the UID cursor.
        self.uid_validity = ""

    async def __aenter__(self) -> EmailClient:
        try:
            self._conn = await asyncio.to_thread(self._factory, self._host, self._port)
            await asyncio.to_thread(self._conn.login, self._username, self._password)
        except imaplib.IMAP4.error as exc:
            raise EmailError(f"IMAP login failed for {self._host}: {exc}") from exc
        except ssl.SSLCertVerificationError as exc:
            reason = getattr(exc, "verify_message", "") or exc
            raise EmailError(
                f"TLS certificate for {self._host} could not be verified ({reason}). "
                "Loom only connects to IMAP servers with a valid certificate."
            ) from exc
        except OSError as exc:
            raise EmailError(f"Cannot reach IMAP host {self._host}:{self._port}: {exc}") from exc
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        if self._conn is not None:
            try:
                await asyncio.to_thread(self._conn.logout)
            except Exception:  # noqa: BLE001 - logout is best-effort
                logger.debug("IMAP logout failed", exc_info=True)
            self._conn = None

    async def validate(self, folder: str) -> dict[str, Any]:
        """Select the folder read-only and report message count — for the
        connection-test endpoint."""
        assert self._conn is not None
        try:
            status, data = await asyncio.to_thread(self._conn.select, folder, True)
        except imaplib.IMAP4.error as exc:
            raise EmailError(f"Cannot open folder {folder!r}: {exc}") from exc
        if status != "OK":
            raise EmailError(f"Cannot open folder {folder!r}")
        exists = int(data[0] or 0) if data else 0
        return {"folder": folder, "messages": exists}

    async def fetch_since(
        self,
        folder: str,
        *,
        since_uid: int,
        lookback_start: datetime,
        limit: int,
        uid_validity: str = "",
    ) -> list[EmailItem]:
        """Fetch up to ``limit`` of the *oldest* messages above ``since_uid``.

        Oldest first, sorted by UID, so a caller that advances its cursor per
        message walks a backlog forward across polls instead of skipping it.
        On a fresh cursor (``since_uid == 0``) the window starts at
        ``lookback_start`` (IMAP ``SINCE`` date search) instead. When the
        folder's UIDVALIDITY differs from ``uid_validity`` the server has
        renumbered it, so the old cursor means nothing and the fetch starts
        over from ``lookback_start``.
        """
        assert self._conn is not None
        try:
            status, _ = await asyncio.to_thread(self._conn.select, folder, True)
            if status != "OK":
                raise EmailError(f"Cannot open folder {folder!r}")
            self.uid_validity = _read_uid_validity(self._conn)
            if uid_validity and self.uid_validity and uid_validity != self.uid_validity:
                logger.info("IMAP folder %r was renumbered; restarting from lookback", folder)
                since_uid = 0
            if since_uid > 0:
                criteria = f"UID {since_uid + 1}:*"
            else:
                criteria = f'SINCE "{lookback_start.strftime(_IMAP_DATE_FMT)}"'
            status, data = await asyncio.to_thread(self._conn.uid, "SEARCH", criteria)
            if status != "OK":
                raise EmailError("IMAP search failed")
            uids = [int(u) for u in (data[0] or b"").split()] if data else []
            uids = [u for u in uids if u > since_uid]
            if not uids:
                return []
            uids = sorted(uids)[:limit]
            uid_set = ",".join(str(u) for u in uids)
            status, fetch_data = await asyncio.to_thread(
                self._conn.uid, "FETCH", uid_set, "(BODY.PEEK[])"
            )
            if status != "OK":
                raise EmailError("IMAP fetch failed")
        except imaplib.IMAP4.error as exc:
            raise EmailError(f"IMAP poll failed: {exc}") from exc

        items: list[EmailItem] = []
        current_uid = 0
        for part in fetch_data or []:
            if not isinstance(part, tuple):
                # Bare flag strings interleave with (headers, body) tuples.
                current_uid = _uid_from_fetch_part(part, current_uid)
                continue
            header_blob, raw = part[0], part[1]
            if not isinstance(raw, bytes):
                continue
            uid = _uid_from_fetch_part(header_blob, current_uid)
            current_uid = uid
            items.append(_parse_message(raw, uid=uid, folder=folder))
        # FETCH responses are not guaranteed to arrive in UID order.
        items.sort(key=lambda item: item.uid)
        return items


def _read_uid_validity(conn: _ImapConnection) -> str:
    """The UIDVALIDITY the server sent with the last SELECT, or ""."""
    response = getattr(conn, "response", None)
    if response is None:
        return ""
    try:
        _code, data = response("UIDVALIDITY")
    except (imaplib.IMAP4.error, ValueError, TypeError):
        return ""
    value = data[-1] if data else None
    if isinstance(value, bytes):
        return value.decode(errors="replace")
    return str(value) if value else ""


def _uid_from_fetch_part(part: Any, fallback: int) -> int:
    """Extract the UID from a FETCH response prelude like b'123 (UID 456'."""
    if isinstance(part, bytes):
        marker = part.decode(errors="replace")
    elif isinstance(part, str):
        marker = part
    else:
        return fallback
    if "UID " in marker:
        try:
            return int(marker.split("UID ", 1)[1].split()[0].rstrip(")"))
        except (ValueError, IndexError):
            return fallback
    return fallback


def _parse_message(raw: bytes, *, uid: int, folder: str) -> EmailItem:
    """Parse one RFC 822 message into an EmailItem (never raises).

    Malformed or hostile mail (e.g. thousands of nested MIME parts, which
    overflow the parser's recursion) becomes a placeholder item. Raising here
    would abort the whole fetch before the cursor moves, so the sync would
    stall on that one message forever.
    """
    try:
        return _parse_message_unchecked(raw, uid=uid, folder=folder)
    except Exception:  # noqa: BLE001 - any parse failure becomes a placeholder
        logger.warning("Could not parse IMAP message uid=%s", uid, exc_info=True)
        return EmailItem(
            uid=uid,
            message_id="",
            subject="(unparseable message)",
            sender="",
            date="",
            body="",
            folder=folder,
        )


def _parse_message_unchecked(raw: bytes, *, uid: int, folder: str) -> EmailItem:
    msg = email.message_from_bytes(raw)
    message_id = (msg.get("Message-ID") or "").strip().strip("<>")
    subject = _clip(_decode_header_value(msg.get("Subject")), _MAX_SUBJECT_CHARS)
    sender = _decode_header_value(msg.get("From"))
    date = _parse_date(msg.get("Date"))
    body = _clip(_extract_body(msg), _MAX_BODY_CHARS)
    return EmailItem(
        uid=uid,
        message_id=message_id,
        subject=subject,
        sender=sender,
        date=date,
        body=body,
        folder=folder,
    )
