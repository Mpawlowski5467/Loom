"""Gmail API adapter for the Google connector: poll a mailbox → capture items.

Read-only parity with the IMAP bridge: the connector's shared token only ever
carries the ``calendar.readonly`` + ``gmail.readonly`` scopes (see
:mod:`bridge.google`) and this adapter only ever calls
``users.messages.list``, ``users.messages.get`` (never ``modify`` or label
endpoints), and ``users.getProfile`` — so polling never marks mail read.

Polling is a bounded window re-list (``q=in:inbox newer_than:<days>d``) plus
capture-ingress idempotency on each message's ``external_id``
(``gmail:<messageId>``) — no historyId cursor complexity. Message parsing
mirrors the IMAP bridge's capture shape (text/plain preferred, stripped-HTML
fallback, attachments ignored) and reuses its decoding/stripping helpers.
"""

from __future__ import annotations

import base64
import logging
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote

import httpx

from bridge.email import (
    _MAX_BODY_CHARS,
    _MAX_SUBJECT_CHARS,
    _clip,
    _decode_header_value,
    _parse_date,
    _strip_html,
)
from bridge.oauth import OAuthTokens

logger = logging.getLogger(__name__)

_TOKEN_URL = "https://oauth2.googleapis.com/token"
_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"
_TIMEOUT = httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=10.0)
_MAX_PAGES = 10
_PAGE_SIZE = 100
_MAX_PART_BYTES = 1024 * 1024


class GmailError(RuntimeError):
    """Raised for Google OAuth/Gmail API failures (network, auth, 4xx/5xx)."""


class GmailAuthError(GmailError):
    """Raised when the stored grant is revoked or rejected — reconnect required."""


def _tokens_from_response(data: Any, *, prior_refresh: str = "") -> OAuthTokens:
    """Validate a token-endpoint payload into :class:`OAuthTokens`."""
    if not isinstance(data, dict):
        raise GmailError("Google returned an unexpected token response")
    access = data.get("access_token")
    if not isinstance(access, str) or not access.strip():
        raise GmailError("Google did not return an access token")
    refresh = data.get("refresh_token")
    refresh_token = refresh.strip() if isinstance(refresh, str) and refresh.strip() else ""
    refresh_token = refresh_token or prior_refresh
    if not refresh_token:
        raise GmailError("Google did not return a refresh token — reconnect")
    try:
        expires_in = float(data.get("expires_in") or 3600.0)
    except (TypeError, ValueError):
        expires_in = 3600.0
    return OAuthTokens(
        access_token=access.strip(),
        refresh_token=refresh_token,
        expires_at=time.time() + max(60.0, expires_in),
    )


@dataclass
class GmailItem:
    """One fetched message, normalized for capture ingress.

    Field-for-field parity with the IMAP bridge's :class:`EmailItem` so the
    resulting Inbox captures are indistinguishable in shape.
    """

    gmail_id: str
    message_id: str  # RFC 822 Message-ID (best effort; empty when absent)
    subject: str
    sender: str
    date: str  # ISO 8601 (best-effort parsed; internalDate fallback)
    body: str
    folder: str = "INBOX"
    labels: list[str] = field(default_factory=list)

    @property
    def external_id(self) -> str:
        return f"gmail:{self.gmail_id}"

    def to_capture_markdown(self) -> str:
        """Render the message as the capture's markdown body (IMAP parity)."""
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
            "gmail_id": self.gmail_id,
            "labels": list(self.labels),
            "date": self.date,
        }


def _decode_part_body(part: dict[str, Any]) -> str:
    """Decode one MIME part's base64url body; oversized parts are skipped."""
    body = part.get("body")
    if not isinstance(body, dict):
        return ""
    size = body.get("size")
    if isinstance(size, int) and size > _MAX_PART_BYTES:
        return ""
    data = body.get("data")
    if not isinstance(data, str) or not data:
        return ""
    try:
        raw = base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))
    except (ValueError, TypeError):
        return ""
    return raw.decode("utf-8", errors="replace")


def _walk_parts(payload: dict[str, Any]) -> Iterator[dict[str, Any]]:
    """Yield every non-container MIME part, deepest-first parents included."""
    mime = str(payload.get("mimeType") or "")
    if not mime.startswith("multipart/"):
        yield payload
    for part in payload.get("parts") or []:
        if isinstance(part, dict):
            yield from _walk_parts(part)


def _extract_body(payload: dict[str, Any]) -> str:
    """Prefer text/plain; fall back to stripped text/html.

    Parts carrying a ``filename`` are attachments and ignored — exactly the
    IMAP bridge's policy.
    """
    plain: str | None = None
    html: str | None = None
    for part in _walk_parts(payload):
        if part.get("filename"):
            continue
        mime = str(part.get("mimeType") or "")
        if mime == "text/plain" and plain is None:
            plain = _decode_part_body(part)
        elif mime == "text/html" and html is None:
            html = _decode_part_body(part)
    if plain and plain.strip():
        return plain.strip()
    if html:
        return _strip_html(html)
    return ""


def _map_message(data: Any) -> GmailItem | None:
    """Normalize one ``users.messages.get`` (format=full) response."""
    if not isinstance(data, dict):
        return None
    gmail_id = str(data.get("id") or "").strip()
    if not gmail_id:
        return None
    payload = data.get("payload")
    payload = payload if isinstance(payload, dict) else {}
    headers = {
        str(header.get("name") or "").lower(): str(header.get("value") or "")
        for header in payload.get("headers") or []
        if isinstance(header, dict)
    }
    subject = _clip(_decode_header_value(headers.get("subject")), _MAX_SUBJECT_CHARS)
    sender = _decode_header_value(headers.get("from"))
    date = _parse_date(headers.get("date"))
    if not date:
        internal = data.get("internalDate")
        if isinstance(internal, str) and internal.isdigit():
            from datetime import UTC, datetime

            date = datetime.fromtimestamp(int(internal) / 1000, tz=UTC).isoformat()
    labels = [str(label) for label in data.get("labelIds") or []][:50]
    folder = "INBOX" if "INBOX" in labels else (labels[0] if labels else "INBOX")
    return GmailItem(
        gmail_id=gmail_id,
        message_id=headers.get("message-id", "").strip().strip("<>"),
        subject=subject,
        sender=sender,
        date=date,
        body=_clip(_extract_body(payload), _MAX_BODY_CHARS),
        folder=folder,
        labels=labels,
    )


class GmailClient:
    """Minimal async Google OAuth + Gmail API client (httpx).

    ``http`` is injectable for tests. ``on_tokens`` fires whenever tokens are
    exchanged or refreshed so the caller can persist them (encrypted).
    """

    def __init__(
        self,
        *,
        client_id: str,
        client_secret: str,
        tokens: OAuthTokens | None = None,
        http: httpx.AsyncClient | None = None,
        on_tokens: Callable[[OAuthTokens], None] | None = None,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._tokens = tokens
        self._on_tokens = on_tokens
        self._owns_http = http is None
        self._http = http or httpx.AsyncClient(
            timeout=_TIMEOUT,
            follow_redirects=False,
            trust_env=False,
        )

    async def aclose(self) -> None:
        if self._owns_http:
            await self._http.aclose()

    @property
    def tokens(self) -> OAuthTokens | None:
        return self._tokens

    def _require_tokens(self) -> OAuthTokens:
        if self._tokens is None:
            raise GmailError("Connect your Gmail account first")
        return self._tokens

    def _adopt_tokens(self, tokens: OAuthTokens) -> OAuthTokens:
        account = self._tokens.account if self._tokens is not None else ""
        tokens.account = tokens.account or account
        self._tokens = tokens
        if self._on_tokens is not None:
            self._on_tokens(tokens)
        return tokens

    async def _post_token(self, form: dict[str, str]) -> Any:
        try:
            resp = await self._http.post(
                _TOKEN_URL,
                data=form,
                headers={"Accept": "application/json"},
            )
        except httpx.HTTPError as exc:
            raise GmailError("Could not reach Google to complete sign-in") from exc
        if resp.status_code == 200:
            try:
                return resp.json()
            except ValueError as exc:
                raise GmailError("Google returned an invalid token response") from exc
        error = ""
        try:
            payload = resp.json()
            error = str(payload.get("error") or "") if isinstance(payload, dict) else ""
        except ValueError:
            pass
        if error == "invalid_grant":
            raise GmailAuthError("Google sign-in was revoked — reconnect your account in Settings")
        raise GmailError(
            f"Google token request failed (HTTP {resp.status_code})"
            + (f": {error}" if error else "")
        )

    async def exchange_code(self, code: str, *, redirect_uri: str) -> OAuthTokens:
        """Trade an authorization code for tokens at the token endpoint."""
        data = await self._post_token(
            {
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri,
            }
        )
        return self._adopt_tokens(_tokens_from_response(data))

    async def ensure_fresh_token(self) -> OAuthTokens:
        """Return a usable access token, refreshing via the refresh grant."""
        tokens = self._require_tokens()
        if tokens.access_token_fresh():
            return tokens
        data = await self._post_token(
            {
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "refresh_token": tokens.refresh_token,
                "grant_type": "refresh_token",
            }
        )
        return self._adopt_tokens(_tokens_from_response(data, prior_refresh=tokens.refresh_token))

    async def _get_json(
        self,
        url: str,
        *,
        params: dict[str, Any] | None = None,
    ) -> Any:
        tokens = await self.ensure_fresh_token()
        try:
            resp = await self._http.get(
                url,
                # ``params=None`` (not {}) — an empty dict would replace the
                # URL's own query string in httpx >= 0.28.
                params=params if params else None,
                headers={"Authorization": f"Bearer {tokens.access_token}"},
            )
        except httpx.HTTPError as exc:
            raise GmailError("Could not reach the Gmail API") from exc
        if resp.status_code == 401:
            raise GmailAuthError(
                "Google rejected the saved tokens — reconnect your account in Settings"
            )
        if resp.status_code == 403:
            raise GmailError(
                "Gmail access was denied (403) — enable the Gmail API for your "
                "OAuth client and reconnect"
            )
        if resp.status_code == 404:
            raise GmailError("Message not found or not accessible")
        if resp.status_code == 429:
            raise GmailError("Gmail API rate limit exceeded — retry later")
        if resp.status_code >= 400:
            raise GmailError(f"Gmail API error {resp.status_code}")
        try:
            return resp.json()
        except ValueError as exc:
            raise GmailError("Gmail returned an invalid response") from exc

    async def fetch_account(self) -> str:
        """Return the mailbox's email address (users.getProfile)."""
        data = await self._get_json(f"{_API_BASE}/profile")
        if isinstance(data, dict):
            return str(data.get("emailAddress") or "")
        return ""

    async def list_message_ids(self, *, query: str, max_messages: int) -> list[str]:
        """List message IDs matching a Gmail search query (pageToken paging)."""
        ids: list[str] = []
        page_token = ""
        for _ in range(_MAX_PAGES):
            params: dict[str, Any] = {
                "q": query,
                "maxResults": min(_PAGE_SIZE, max_messages - len(ids)),
            }
            if page_token:
                params["pageToken"] = page_token
            data = await self._get_json(f"{_API_BASE}/messages", params=params)
            messages = data.get("messages") if isinstance(data, dict) else None
            for entry in messages or []:
                if isinstance(entry, dict) and entry.get("id"):
                    ids.append(str(entry["id"]))
                    if len(ids) >= max_messages:
                        return ids
            page_token = str(data.get("nextPageToken") or "") if isinstance(data, dict) else ""
            if not page_token:
                break
        return ids

    async def fetch_message(self, message_id: str) -> GmailItem | None:
        """Fetch and normalize one message (``format=full``)."""
        data = await self._get_json(
            f"{_API_BASE}/messages/{quote(message_id, safe='')}",
            params={"format": "full"},
        )
        return _map_message(data)
