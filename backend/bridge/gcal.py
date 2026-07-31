"""Google Calendar API adapter for the Google connector: poll events → captures.

Read-only by construction: the connector's shared token only ever carries the
``calendar.readonly`` + ``gmail.readonly`` scopes (see :mod:`bridge.google`).
``GoogleCalendarClient`` covers the authorization-code exchange, access-token
refresh, account lookup, and ``events.list`` with incremental ``syncToken``
support (callers fall back to a ``timeMin``/``timeMax`` window when Google
invalidates a token with 410 Gone). Events normalize into the shared
:class:`CalendarEvent` shape from the iCal bridge; capture idempotency keys
are built by the service layer (``gcal:<calendarId>:<eventId>[:<start>]``).
"""

from __future__ import annotations

import contextlib
import logging
import time
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from datetime import time as dtime
from typing import Any
from urllib.parse import quote
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

from bridge.calendar import CalendarEvent, _safe_event_url
from bridge.oauth import OAuthTokens

logger = logging.getLogger(__name__)

_TOKEN_URL = "https://oauth2.googleapis.com/token"
_API_BASE = "https://www.googleapis.com/calendar/v3"
_TIMEOUT = httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=10.0)
_MAX_PAGES = 20
_PAGE_SIZE = 250
_MAX_FIELD_CHARS = 20_000


class GoogleCalendarError(RuntimeError):
    """Raised for Google OAuth/Calendar API failures (network, auth, 4xx/5xx)."""


class GoogleCalendarAuthError(GoogleCalendarError):
    """Raised when the stored grant is revoked or rejected — reconnect required."""


class GoogleSyncTokenExpired(GoogleCalendarError):
    """Raised when Google invalidates an incremental sync token (410 Gone)."""


def _tokens_from_response(data: Any, *, prior_refresh: str = "") -> OAuthTokens:
    """Validate a token-endpoint payload into :class:`OAuthTokens`."""
    if not isinstance(data, dict):
        raise GoogleCalendarError("Google returned an unexpected token response")
    access = data.get("access_token")
    if not isinstance(access, str) or not access.strip():
        raise GoogleCalendarError("Google did not return an access token")
    refresh = data.get("refresh_token")
    refresh_token = refresh.strip() if isinstance(refresh, str) and refresh.strip() else ""
    refresh_token = refresh_token or prior_refresh
    if not refresh_token:
        raise GoogleCalendarError("Google did not return a refresh token — reconnect")
    try:
        expires_in = float(data.get("expires_in") or 3600.0)
    except (TypeError, ValueError):
        expires_in = 3600.0
    return OAuthTokens(
        access_token=access.strip(),
        refresh_token=refresh_token,
        expires_at=time.time() + max(60.0, expires_in),
    )


def _rfc3339(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()[:_MAX_FIELD_CHARS]


def _single_line(value: Any, limit: int) -> str:
    return " ".join(_text(value).split())[:limit]


def _parse_event_time(payload: Any, default_tz: ZoneInfo) -> datetime | None:
    """Parse a Google ``start``/``end`` object (``date`` or ``dateTime``)."""
    if not isinstance(payload, dict):
        return None
    tz = default_tz
    tz_name = payload.get("timeZone")
    if isinstance(tz_name, str) and tz_name:
        with contextlib.suppress(ZoneInfoNotFoundError, ValueError):
            tz = ZoneInfo(tz_name)
    raw_date = payload.get("date")
    raw_dt = payload.get("dateTime")
    if raw_date and not raw_dt:
        try:
            day = date.fromisoformat(str(raw_date)[:10])
        except ValueError:
            return None
        return datetime.combine(day, dtime.min, tzinfo=tz)
    if not raw_dt:
        return None
    try:
        parsed = datetime.fromisoformat(str(raw_dt).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=tz)
    return parsed


def _map_event(raw: Any, default_tz: ZoneInfo, calendar_name: str) -> CalendarEvent | None:
    """Normalize one Google event; ``None`` for cancelled/malformed entries."""
    if not isinstance(raw, dict) or raw.get("status") == "cancelled":
        return None
    event_id = str(raw.get("id") or "").strip()
    if not event_id:
        return None
    start_obj = raw.get("start")
    all_day = isinstance(start_obj, dict) and "date" in start_obj
    start = _parse_event_time(start_obj, default_tz)
    end = _parse_event_time(raw.get("end"), default_tz)
    if start is None or end is None:
        return None
    if end <= start:
        end = start + (timedelta(days=1) if all_day else timedelta(hours=1))
    recurrence_id = None
    if raw.get("originalStartTime") is not None:
        recurrence_id = _parse_event_time(raw.get("originalStartTime"), default_tz)
    attendees: list[str] = []
    for entry in (raw.get("attendees") or [])[:100]:
        if not isinstance(entry, dict):
            continue
        label = _single_line(entry.get("displayName") or entry.get("email"), 300)
        if label:
            attendees.append(label)
    return CalendarEvent(
        uid=event_id,
        title=_single_line(raw.get("summary"), 300) or "Untitled event",
        start=start,
        end=end,
        all_day=all_day,
        recurrence_id=recurrence_id,
        description=_text(raw.get("description")),
        location=_single_line(raw.get("location"), 300),
        attendees=tuple(attendees),
        url=_safe_event_url(_text(raw.get("htmlLink"))),
        calendar_name=calendar_name[:300] or "Google Calendar",
    )


class GoogleCalendarClient:
    """Minimal async Google OAuth + Calendar API client (httpx).

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
            raise GoogleCalendarError("Connect your Google account first")
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
            raise GoogleCalendarError("Could not reach Google to complete sign-in") from exc
        if resp.status_code == 200:
            try:
                return resp.json()
            except ValueError as exc:
                raise GoogleCalendarError("Google returned an invalid token response") from exc
        error = ""
        try:
            payload = resp.json()
            error = str(payload.get("error") or "") if isinstance(payload, dict) else ""
        except ValueError:
            pass
        if error == "invalid_grant":
            raise GoogleCalendarAuthError(
                "Google sign-in was revoked — reconnect your account in Settings"
            )
        raise GoogleCalendarError(
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
            raise GoogleCalendarError("Could not reach the Google Calendar API") from exc
        if resp.status_code == 401:
            raise GoogleCalendarAuthError(
                "Google rejected the saved tokens — reconnect your account in Settings"
            )
        if resp.status_code == 403:
            raise GoogleCalendarError(
                "Google Calendar access was denied (403) — enable the Calendar API "
                "for your OAuth client and reconnect"
            )
        if resp.status_code == 404:
            raise GoogleCalendarError("Calendar not found or not accessible")
        if resp.status_code == 410:
            raise GoogleSyncTokenExpired("Google invalidated the sync token (410 Gone)")
        if resp.status_code >= 400:
            raise GoogleCalendarError(f"Google Calendar API error {resp.status_code}")
        try:
            return resp.json()
        except ValueError as exc:
            raise GoogleCalendarError("Google Calendar returned an invalid response") from exc

    async def fetch_account(self) -> str:
        """Return the primary calendar ID (the account email for Gmail users)."""
        data = await self._get_json(f"{_API_BASE}/calendars/primary")
        if isinstance(data, dict):
            return str(data.get("id") or "")
        return ""

    async def list_events(
        self,
        calendar_id: str,
        *,
        sync_token: str | None,
        time_min: datetime,
        time_max: datetime,
        default_tz: str = "UTC",
        calendar_name: str = "",
    ) -> tuple[list[CalendarEvent], str]:
        """List events for one calendar, following pagination.

        With ``sync_token`` the call is incremental (Google forbids combining
        it with the window parameters); otherwise a ``timeMin``/``timeMax``
        window with expanded single events is listed. Returns the events plus
        the next sync token (empty when Google withheld it).
        """
        try:
            tz = ZoneInfo(default_tz)
        except (ZoneInfoNotFoundError, ValueError):
            tz = ZoneInfo("UTC")
        events: list[CalendarEvent] = []
        next_sync_token = ""
        page_token = ""
        path = f"{_API_BASE}/calendars/{quote(calendar_id, safe='')}/events"
        for _ in range(_MAX_PAGES):
            params: dict[str, Any]
            if sync_token:
                params = {"syncToken": sync_token, "maxResults": _PAGE_SIZE}
            else:
                params = {
                    "timeMin": _rfc3339(time_min),
                    "timeMax": _rfc3339(time_max),
                    "singleEvents": "true",
                    "orderBy": "startTime",
                    "showDeleted": "false",
                    "maxResults": _PAGE_SIZE,
                }
            if page_token:
                params["pageToken"] = page_token
            data = await self._get_json(path, params=params)
            items = data.get("items") if isinstance(data, dict) else None
            for raw in items or []:
                event = _map_event(raw, tz, calendar_name or calendar_id)
                if event is not None:
                    events.append(event)
            page_token = str(data.get("nextPageToken") or "") if isinstance(data, dict) else ""
            if not page_token:
                if isinstance(data, dict):
                    next_sync_token = str(data.get("nextSyncToken") or "")
                break
        return events, next_sync_token
