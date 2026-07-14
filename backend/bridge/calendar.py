"""Read-only iCalendar bridge used by Standup and Inbox synchronization.

Private iCalendar feeds are intentionally the first calendar connection: they
work with Google, Outlook, Apple, and most CalDAV servers without adding an
OAuth callback surface.  Feed URLs are configured separately and encrypted at
rest by :mod:`core.config`; this module never logs or persists them.
"""

from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import socket
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import TYPE_CHECKING, Any
from urllib.parse import urljoin, urlsplit, urlunsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
import recurring_ical_events
from icalendar import Calendar

from agents.sanitize import scrub_untrusted

if TYPE_CHECKING:
    from icalendar.cal import Component

_MAX_FEED_BYTES = 5 * 1024 * 1024
_FETCH_TIMEOUT_SECONDS = 15.0
_MAX_FIELD_CHARS = 20_000
_MAX_SOURCE_EVENTS = 5_000
_MAX_EVENTS_PER_DAY = 1_000
_MAX_REDIRECTS = 5
_REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})


class CalendarFeedError(ValueError):
    """A safe, user-facing calendar fetch or parse failure."""


@dataclass(frozen=True, slots=True)
class CalendarEvent:
    """Normalized occurrence from an iCalendar feed."""

    uid: str
    title: str
    start: datetime
    end: datetime
    all_day: bool
    recurrence_id: datetime | None = None
    description: str = ""
    location: str = ""
    attendees: tuple[str, ...] = ()
    url: str = ""
    calendar_name: str = "Calendar"

    @property
    def external_id(self) -> str:
        """Stable per-occurrence key suitable for capture idempotency."""
        occurrence = self.recurrence_id or self.start
        identity = (
            occurrence.date().isoformat()
            if self.all_day
            else occurrence.astimezone(UTC).isoformat()
        )
        seed = f"{self.uid}\x00{identity}".encode()
        return f"calendar:{hashlib.sha256(seed).hexdigest()[:40]}"

    def to_prompt_markdown(self) -> str:
        """Render bounded, scrubbed event context for an LLM prompt."""
        when = (
            self.start.strftime("%Y-%m-%d (all day)")
            if self.all_day
            else f"{self.start.strftime('%H:%M')} to {self.end.strftime('%H:%M')}"
        )
        lines = [f"- {when} — {scrub_untrusted(self.title)}"]
        details: list[str] = []
        if self.location:
            details.append(f"location: {scrub_untrusted(self.location)}")
        if self.attendees:
            visible = self.attendees[:10]
            attendee_text = ", ".join(scrub_untrusted(value) for value in visible)
            if len(self.attendees) > len(visible):
                attendee_text += f", and {len(self.attendees) - len(visible)} more"
            details.append(
                "attendees: " + attendee_text
            )
        if details:
            lines.append(f"  {'; '.join(details)}")
        return "\n".join(lines)

    def to_capture_markdown(self) -> str:
        """Render a safe Markdown capture body for this occurrence."""
        start = self.start.isoformat()
        end = self.end.isoformat()
        rows = [
            "## Calendar event",
            "",
            f"- **When:** {start} → {end}",
            f"- **Calendar:** {scrub_untrusted(self.calendar_name)}",
        ]
        if self.location:
            rows.append(f"- **Location:** {scrub_untrusted(self.location)}")
        if self.attendees:
            rows.append(
                "- **Attendees:** "
                + ", ".join(scrub_untrusted(value) for value in self.attendees)
            )
        if self.url:
            rows.append(f"- **Link:** <{self.url}>")
        if self.description:
            rows.extend(["", "## Description", "", scrub_untrusted(self.description)])
        return "\n".join(rows).rstrip() + "\n"


def normalize_feed_url(raw: str) -> str:
    """Validate and normalize a user-provided HTTP(S)/webcal feed URL."""
    value = raw.strip()
    if len(value) > 4096:
        raise CalendarFeedError("Calendar feed URL is too long")
    if any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise CalendarFeedError("Calendar feed URL contains invalid characters")
    parts = urlsplit(value)
    scheme = parts.scheme.lower()
    if scheme == "webcal":
        scheme = "https"
    if scheme not in {"http", "https"} or not parts.netloc or not parts.hostname:
        raise CalendarFeedError("Calendar feed must be an http, https, or webcal URL")
    if parts.username is not None or parts.password is not None:
        raise CalendarFeedError("Calendar feed URL must not contain embedded credentials")
    if "\\" in parts.netloc:
        raise CalendarFeedError("Calendar feed URL contains an invalid host")
    try:
        port = parts.port
    except ValueError as exc:
        raise CalendarFeedError("Calendar feed URL contains an invalid port") from exc
    if port == 0:
        raise CalendarFeedError("Calendar feed URL contains an invalid port")
    host = parts.hostname.rstrip(".").casefold()
    if host == "localhost" or host.endswith((".localhost", ".local")):
        raise CalendarFeedError("Calendar feed host must be a public address")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        if not address.is_global:
            raise CalendarFeedError("Calendar feed host must be a public address")
    # Fragments are never sent to servers and can make two identical feeds look
    # different in settings; discard them at the boundary.
    return urlunsplit((scheme, parts.netloc, parts.path, parts.query, ""))


def timezone_or_error(name: str) -> ZoneInfo:
    """Resolve an IANA timezone with a stable validation error."""
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise CalendarFeedError(f"Unknown timezone: {name}") from exc


async def fetch_feed(
    feed_url: str,
    *,
    client: httpx.AsyncClient | None = None,
) -> bytes:
    """Fetch an iCalendar feed with timeout and response-size bounds."""
    logical_url = normalize_feed_url(feed_url)
    owns_client = client is None
    session = client or httpx.AsyncClient(
        follow_redirects=False,
        limits=httpx.Limits(max_keepalive_connections=0),
        timeout=httpx.Timeout(_FETCH_TIMEOUT_SECONDS),
        trust_env=False,
    )
    try:
        async with asyncio.timeout(_FETCH_TIMEOUT_SECONDS):
            for redirect_count in range(_MAX_REDIRECTS + 1):
                addresses: list[str | None]
                if owns_client:
                    addresses = list(await _resolve_public_addresses(logical_url))
                else:
                    # Injected clients are used by tests and trusted in-process
                    # callers. Redirect targets still pass static URL checks.
                    addresses = [None]

                redirect_url = ""
                last_connect_error: httpx.TransportError | None = None
                for address in addresses:
                    request_url, headers, extensions = _request_target(logical_url, address)
                    try:
                        async with session.stream(
                            "GET",
                            request_url,
                            headers=headers,
                            extensions=extensions,
                            follow_redirects=False,
                        ) as response:
                            if response.status_code in _REDIRECT_STATUSES:
                                location = response.headers.get("location")
                                if not location:
                                    raise CalendarFeedError(
                                        "Calendar feed returned an invalid redirect"
                                    )
                                redirect_url = normalize_feed_url(urljoin(logical_url, location))
                                if (
                                    urlsplit(logical_url).scheme == "https"
                                    and urlsplit(redirect_url).scheme != "https"
                                ):
                                    raise CalendarFeedError(
                                        "Calendar feed redirected to an insecure URL"
                                    )
                                break
                            response.raise_for_status()
                            return await _read_bounded_response(response)
                    except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
                        last_connect_error = exc
                        continue
                if redirect_url:
                    if redirect_count >= _MAX_REDIRECTS:
                        raise CalendarFeedError("Calendar feed redirected too many times")
                    logical_url = redirect_url
                    continue
                if last_connect_error is not None:
                    raise CalendarFeedError("Calendar feed could not be reached") from last_connect_error
                raise CalendarFeedError("Calendar feed could not be reached")
            raise CalendarFeedError("Calendar feed redirected too many times")
    except CalendarFeedError:
        raise
    except TimeoutError as exc:
        raise CalendarFeedError("Calendar feed timed out") from exc
    except httpx.TimeoutException as exc:
        raise CalendarFeedError("Calendar feed timed out") from exc
    except httpx.HTTPStatusError as exc:
        raise CalendarFeedError(f"Calendar feed returned HTTP {exc.response.status_code}") from exc
    except httpx.HTTPError as exc:
        raise CalendarFeedError("Calendar feed could not be reached") from exc
    finally:
        if owns_client:
            await session.aclose()


async def _read_bounded_response(response: httpx.Response) -> bytes:
    declared = response.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > _MAX_FEED_BYTES:
        raise CalendarFeedError("Calendar feed exceeds the 5 MB limit")
    chunks: list[bytes] = []
    total = 0
    async for chunk in response.aiter_bytes():
        total += len(chunk)
        if total > _MAX_FEED_BYTES:
            raise CalendarFeedError("Calendar feed exceeds the 5 MB limit")
        chunks.append(chunk)
    if not chunks:
        raise CalendarFeedError("Calendar feed is empty")
    return b"".join(chunks)


async def _resolve_public_addresses(url: str) -> tuple[str, ...]:
    """Resolve once and return only globally routable targets for a pinned request."""
    parts = urlsplit(url)
    host = parts.hostname or ""
    port = parts.port or (443 if parts.scheme == "https" else 80)
    try:
        infos = await asyncio.to_thread(
            socket.getaddrinfo,
            host.encode("idna").decode("ascii"),
            port,
            type=socket.SOCK_STREAM,
        )
    except (OSError, UnicodeError) as exc:
        raise CalendarFeedError("Calendar feed host could not be resolved") from exc
    addresses = {info[4][0] for info in infos}
    if not addresses:
        raise CalendarFeedError("Calendar feed host could not be resolved")
    parsed = [ipaddress.ip_address(address) for address in addresses]
    if any(not address.is_global for address in parsed):
        raise CalendarFeedError("Calendar feed host must be a public address")
    # IPv4 first avoids failing on hosts that publish IPv6 when the local
    # machine has no usable IPv6 route. Each address remains pinned per try.
    return tuple(str(address) for address in sorted(parsed, key=lambda item: item.version))


def _request_target(
    logical_url: str,
    address: str | None,
) -> tuple[str, dict[str, str], dict[str, Any] | None]:
    headers = {"Accept": "text/calendar,*/*;q=0.1"}
    if address is None:
        return logical_url, headers, None
    url = httpx.URL(logical_url)
    headers["Host"] = url.netloc.decode("ascii")
    extensions: dict[str, Any] = {"sni_hostname": url.raw_host.decode("ascii")}
    return str(url.copy_with(host=address)), headers, extensions


async def events_for_date(
    feed_url: str,
    target_date: date,
    timezone: str,
    *,
    calendar_name: str = "Calendar",
    client: httpx.AsyncClient | None = None,
) -> list[CalendarEvent]:
    """Fetch and expand all event occurrences intersecting ``target_date``."""
    payload = await fetch_feed(feed_url, client=client)
    return await asyncio.to_thread(
        parse_events,
        payload,
        target_date,
        timezone,
        calendar_name,
    )


def parse_events(
    payload: bytes,
    target_date: date,
    timezone: str,
    calendar_name: str = "Calendar",
) -> list[CalendarEvent]:
    """Parse and recurrence-expand a bounded iCalendar payload."""
    tz = timezone_or_error(timezone)
    start = datetime.combine(target_date, time.min, tzinfo=tz)
    stop = start + timedelta(days=1)
    try:
        calendar = Calendar.from_ical(payload)
        _repair_cancelled_overrides(calendar)
        _validate_calendar_complexity(calendar)
        components = recurring_ical_events.of(calendar, skip_bad_series=True).between(start, stop)
        if len(components) > _MAX_EVENTS_PER_DAY:
            raise CalendarFeedError(
                f"Calendar feed has more than {_MAX_EVENTS_PER_DAY} events in one day"
            )
    except CalendarFeedError:
        raise
    except Exception as exc:  # library raises several ValueError subclasses
        raise CalendarFeedError("Calendar feed is not valid iCalendar data") from exc

    events: list[CalendarEvent] = []
    seen: set[tuple[str, str]] = set()
    for component in components:
        if _text(component.get("STATUS")).upper() == "CANCELLED":
            continue
        try:
            event = _normalize_component(component, tz, calendar_name)
        except (KeyError, TypeError, ValueError, OverflowError):
            continue
        key = (event.uid, event.external_id)
        if key in seen:
            continue
        seen.add(key)
        # ``between`` can include an event ending exactly at the lower bound;
        # retain only true overlap with the requested local day.
        if event.end > start and event.start < stop:
            events.append(event)
    events.sort(key=lambda event: (event.start, event.end, event.title.casefold()))
    return events


def _normalize_component(
    component: Component,
    timezone: ZoneInfo,
    calendar_name: str,
) -> CalendarEvent:
    raw_start = component.decoded("DTSTART")
    all_day = isinstance(raw_start, date) and not isinstance(raw_start, datetime)
    start = _as_datetime(raw_start, timezone)
    raw_recurrence_id = (
        component.decoded("RECURRENCE-ID")
        if component.get("RECURRENCE-ID") is not None
        else None
    )
    recurrence_id = (
        _as_datetime(raw_recurrence_id, timezone) if raw_recurrence_id is not None else None
    )
    raw_end = component.decoded("DTEND") if component.get("DTEND") is not None else None
    if raw_end is None:
        raw_duration = (
            component.decoded("DURATION") if component.get("DURATION") is not None else None
        )
        duration = raw_duration if isinstance(raw_duration, timedelta) else None
        end = start + (
            duration
            if duration is not None and duration > timedelta(0)
            else (timedelta(days=1) if all_day else timedelta(hours=1))
        )
    else:
        end = _as_datetime(raw_end, timezone)
    if end <= start:
        end = start + (timedelta(days=1) if all_day else timedelta(hours=1))

    title = _single_line(component.get("SUMMARY"), 300) or "Untitled event"
    uid = _single_line(component.get("UID"), 1_000)
    if not uid:
        uid = hashlib.sha256(f"{title}\x00{start.isoformat()}".encode()).hexdigest()
    attendees = tuple(
        value
        for value in (
            _attendee_text(item) for item in _as_list(component.get("ATTENDEE"))[:100]
        )
        if value
    )
    return CalendarEvent(
        uid=uid,
        title=title,
        start=start,
        end=end,
        all_day=all_day,
        recurrence_id=recurrence_id,
        description=_text(component.get("DESCRIPTION")),
        location=_single_line(component.get("LOCATION"), 300),
        attendees=attendees,
        url=_safe_event_url(_text(component.get("URL"))),
        calendar_name=(calendar_name.strip() or "Calendar")[:300],
    )


def _as_datetime(value: date | datetime, timezone: ZoneInfo) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone)
        return value.astimezone(timezone)
    return datetime.combine(value, time.min, tzinfo=timezone)


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()[:_MAX_FIELD_CHARS]


def _single_line(value: Any, limit: int) -> str:
    text = _text(value)
    return " ".join(text.split())[:limit]


def _attendee_text(value: Any) -> str:
    params = getattr(value, "params", {})
    common_name = _text(params.get("CN")) if params else ""
    if common_name:
        return _single_line(common_name, 300)
    raw = _text(value)
    if raw.lower().startswith("mailto:"):
        raw = raw[7:]
    return _single_line(raw, 300)


def _safe_event_url(value: str) -> str:
    if not value:
        return ""
    if any(ord(char) < 32 or ord(char) == 127 for char in value):
        return ""
    parts = urlsplit(value[:4096])
    if (
        parts.scheme.lower() not in {"http", "https"}
        or not parts.hostname
        or parts.username is not None
        or parts.password is not None
    ):
        return ""
    try:
        return str(httpx.URL(value[:4096]))
    except httpx.InvalidURL:
        return ""


def _validate_calendar_complexity(calendar: Calendar) -> None:
    """Reject recurrence shapes that can expand into unbounded daily work."""
    source_events = list(calendar.walk("VEVENT"))
    if len(source_events) > _MAX_SOURCE_EVENTS:
        raise CalendarFeedError("Calendar feed contains too many source events")
    recurrence_budget = 0
    for component in source_events:
        rule = component.get("RRULE")
        if rule is None:
            continue
        frequency_values = rule.get("FREQ", [])
        frequency = str(frequency_values[0]).upper() if frequency_values else ""
        if frequency in {"SECONDLY", "MINUTELY"}:
            raise CalendarFeedError("Calendar feed recurrence is too frequent")
        hours = len(rule.get("BYHOUR", [])) or (24 if frequency == "HOURLY" else 1)
        minutes = len(rule.get("BYMINUTE", [])) or 1
        seconds = len(rule.get("BYSECOND", [])) or 1
        recurrence_budget += hours * minutes * seconds
        if recurrence_budget > _MAX_EVENTS_PER_DAY:
            raise CalendarFeedError(
                f"Calendar feed can expand beyond {_MAX_EVENTS_PER_DAY} events in one day"
            )


def _repair_cancelled_overrides(calendar: Calendar) -> None:
    """Let the recurrence library consume valid cancellations without DTSTART.

    Cancellation exceptions are identified by ``RECURRENCE-ID``; several
    providers omit the otherwise-required ``DTSTART`` because the event no
    longer occurs. The recurrence library requires it while assembling the
    series, so use the recurrence slot as a temporary start. The normalized
    result is still discarded by the STATUS check above.
    """
    for component in calendar.walk("VEVENT"):
        if (
            _text(component.get("STATUS")).upper() == "CANCELLED"
            and component.get("DTSTART") is None
            and component.get("RECURRENCE-ID") is not None
        ):
            component["DTSTART"] = component["RECURRENCE-ID"]
