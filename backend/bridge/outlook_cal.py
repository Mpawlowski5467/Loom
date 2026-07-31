"""Outlook Calendar OAuth adapter: poll events via Microsoft Graph → captures.

Read-only by construction: the only requested scopes are ``offline_access``
(for the refresh token) and ``Calendars.Read``. The user registers their own
app at entra.microsoft.com / portal.azure.com with a localhost "Web" redirect
URI; Loom never ships a client ID. ``OutlookCalendarClient`` covers the
authorization-code exchange against the Microsoft identity platform v2,
access-token refresh, account lookup, and ``/me/calendarView`` listing over a
bounded time window (no delta tokens — the window plus capture-ingress
idempotency keeps re-syncs cheap and duplicate-free). Events normalize into
the shared :class:`CalendarEvent` shape; capture idempotency keys are built by
the service layer (``outlook-cal:<calendarId>:<eventId>``).
"""

from __future__ import annotations

import logging
import re
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from datetime import time as dtime
from typing import Any
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

from bridge.calendar import CalendarEvent, _safe_event_url
from bridge.oauth import OAuthTokens

logger = logging.getLogger(__name__)

_AUTHORIZE_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
_GRAPH_BASE = "https://graph.microsoft.com/v1.0"
_SCOPE = "offline_access Calendars.Read"
_TIMEOUT = httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=10.0)
_MAX_PAGES = 20
_PAGE_SIZE = 50
_MAX_FIELD_CHARS = 20_000
_EVENT_SELECT = (
    "id,subject,bodyPreview,start,end,isAllDay,isCancelled,location,attendees,"
    "webLink,seriesMasterId,type"
)


class OutlookCalendarError(RuntimeError):
    """Raised for Microsoft identity/Graph failures (network, auth, 4xx/5xx)."""


class OutlookCalendarAuthError(OutlookCalendarError):
    """Raised when the stored grant is revoked or rejected — reconnect required."""


def authorization_url(*, client_id: str, redirect_uri: str, state: str) -> str:
    """Build the Microsoft identity platform v2 consent URL for one flow."""
    query = urlencode(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "response_mode": "query",
            "scope": _SCOPE,
            "state": state,
        }
    )
    return f"{_AUTHORIZE_URL}?{query}"


def _tokens_from_response(data: Any, *, prior_refresh: str = "") -> OAuthTokens:
    """Validate a token-endpoint payload into :class:`OAuthTokens`."""
    if not isinstance(data, dict):
        raise OutlookCalendarError("Microsoft returned an unexpected token response")
    access = data.get("access_token")
    if not isinstance(access, str) or not access.strip():
        raise OutlookCalendarError("Microsoft did not return an access token")
    refresh = data.get("refresh_token")
    refresh_token = refresh.strip() if isinstance(refresh, str) and refresh.strip() else ""
    refresh_token = refresh_token or prior_refresh
    if not refresh_token:
        raise OutlookCalendarError("Microsoft did not return a refresh token — reconnect")
    try:
        expires_in = float(data.get("expires_in") or 3600.0)
    except (TypeError, ValueError):
        expires_in = 3600.0
    return OAuthTokens(
        access_token=access.strip(),
        refresh_token=refresh_token,
        expires_at=time.time() + max(60.0, expires_in),
    )


def _graph_time(value: datetime) -> str:
    """Format a window bound the way calendarView expects (UTC, no offset)."""
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S")


def _text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()[:_MAX_FIELD_CHARS]


def _single_line(value: Any, limit: int) -> str:
    return " ".join(_text(value).split())[:limit]


_FRACTION_RE = re.compile(r"\.(\d+)")


def _parse_graph_time(payload: Any, default_tz: ZoneInfo, all_day: bool) -> datetime | None:
    """Parse a Graph ``start``/``end`` object (``dateTime`` + ``timeZone``).

    Requests carry ``Prefer: outlook.timezone="UTC"``, so timed values arrive
    in UTC; all-day values are date-midnight and are localized to the vault
    timezone like the iCal bridge does.
    """
    if not isinstance(payload, dict):
        return None
    raw = _text(payload.get("dateTime"))[:64]
    if not raw:
        return None
    # Graph emits up to 7 fractional digits; trim to what fromisoformat takes.
    raw = _FRACTION_RE.sub(lambda match: "." + match.group(1)[:6], raw, count=1)
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if all_day:
        return datetime.combine(parsed.date(), dtime.min, tzinfo=default_tz)
    if parsed.tzinfo is None:
        tz: Any = UTC
        tz_name = payload.get("timeZone")
        if isinstance(tz_name, str) and tz_name:
            try:
                tz = ZoneInfo(tz_name)
            except (ZoneInfoNotFoundError, ValueError):
                # Graph often reports Windows zone names; the Prefer header
                # above keeps values UTC, so that fallback is safe.
                tz = UTC
        parsed = parsed.replace(tzinfo=tz)
    return parsed


def _map_event(raw: Any, default_tz: ZoneInfo, calendar_name: str) -> CalendarEvent | None:
    """Normalize one Graph event; ``None`` for cancelled/malformed entries."""
    if not isinstance(raw, dict) or raw.get("isCancelled"):
        return None
    event_id = _text(raw.get("id"))
    if not event_id:
        return None
    all_day = bool(raw.get("isAllDay"))
    start = _parse_graph_time(raw.get("start"), default_tz, all_day)
    end = _parse_graph_time(raw.get("end"), default_tz, all_day)
    if start is None or end is None:
        return None
    if end <= start:
        end = start + (timedelta(days=1) if all_day else timedelta(hours=1))
    recurrence_id = None
    if raw.get("seriesMasterId") and raw.get("type") in {"occurrence", "exception"}:
        # calendarView expands series; the occurrence start identifies the slot.
        recurrence_id = start
    attendees: list[str] = []
    for entry in (raw.get("attendees") or [])[:100]:
        if not isinstance(entry, dict):
            continue
        address = entry.get("emailAddress")
        if not isinstance(address, dict):
            continue
        label = _single_line(address.get("name") or address.get("address"), 300)
        if label:
            attendees.append(label)
    location = raw.get("location")
    return CalendarEvent(
        uid=event_id,
        title=_single_line(raw.get("subject"), 300) or "Untitled event",
        start=start,
        end=end,
        all_day=all_day,
        recurrence_id=recurrence_id,
        description=_text(raw.get("bodyPreview")),
        location=_single_line(
            location.get("displayName") if isinstance(location, dict) else "", 300
        ),
        attendees=tuple(attendees),
        url=_safe_event_url(_text(raw.get("webLink"))),
        calendar_name=calendar_name[:300] or "Outlook Calendar",
    )


class OutlookCalendarClient:
    """Minimal async Microsoft identity + Graph client (httpx).

    ``http`` is injectable for tests. ``on_tokens`` fires whenever tokens are
    exchanged or refreshed so the caller can persist them (encrypted) —
    Microsoft rotates refresh tokens, so persisting every refresh matters.
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
            raise OutlookCalendarError("Connect your Outlook account first")
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
            raise OutlookCalendarError("Could not reach Microsoft to complete sign-in") from exc
        if resp.status_code == 200:
            try:
                return resp.json()
            except ValueError as exc:
                raise OutlookCalendarError("Microsoft returned an invalid token response") from exc
        error = ""
        try:
            payload = resp.json()
            error = str(payload.get("error") or "") if isinstance(payload, dict) else ""
        except ValueError:
            pass
        if error == "invalid_grant":
            raise OutlookCalendarAuthError(
                "Microsoft sign-in was revoked — reconnect your account in Settings"
            )
        raise OutlookCalendarError(
            f"Microsoft token request failed (HTTP {resp.status_code})"
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
                "scope": _SCOPE,
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
                "scope": _SCOPE,
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
                # ``params=None`` (not {}) — an empty dict replaces the URL's
                # own query string, which would strip @odata.nextLink cursors.
                params=params if params else None,
                headers={
                    "Authorization": f"Bearer {tokens.access_token}",
                    "Prefer": 'outlook.timezone="UTC"',
                },
            )
        except httpx.HTTPError as exc:
            raise OutlookCalendarError("Could not reach Microsoft Graph") from exc
        if resp.status_code == 401:
            raise OutlookCalendarAuthError(
                "Microsoft rejected the saved tokens — reconnect your account in Settings"
            )
        if resp.status_code == 403:
            raise OutlookCalendarError(
                "Microsoft Graph access was denied (403) — grant Calendars.Read "
                "on your app registration and reconnect"
            )
        if resp.status_code == 404:
            raise OutlookCalendarError("Calendar not found or not accessible")
        if resp.status_code >= 400:
            raise OutlookCalendarError(f"Microsoft Graph error {resp.status_code}")
        try:
            return resp.json()
        except ValueError as exc:
            raise OutlookCalendarError("Microsoft Graph returned an invalid response") from exc

    async def fetch_account(self) -> str:
        """Return the signed-in user's mail (or principal name) for display."""
        data = await self._get_json(
            f"{_GRAPH_BASE}/me",
            params={"$select": "mail,userPrincipalName"},
        )
        if isinstance(data, dict):
            return str(data.get("mail") or data.get("userPrincipalName") or "")
        return ""

    async def list_events(
        self,
        calendar_id: str,
        *,
        time_min: datetime,
        time_max: datetime,
        default_tz: str = "UTC",
        calendar_name: str = "",
    ) -> list[CalendarEvent]:
        """List one calendar's occurrences inside the bounded window.

        ``calendar_id`` of ``primary`` addresses the default calendar via
        ``/me/calendarView``; any other ID uses ``/me/calendars/{id}`` .
        ``@odata.nextLink`` pagination is followed (bounded by ``_MAX_PAGES``).
        """
        try:
            tz = ZoneInfo(default_tz)
        except (ZoneInfoNotFoundError, ValueError):
            tz = ZoneInfo("UTC")
        if calendar_id and calendar_id != "primary":
            url: str | None = (
                f"{_GRAPH_BASE}/me/calendars/{quote(calendar_id, safe='')}/calendarView"
            )
        else:
            url = f"{_GRAPH_BASE}/me/calendarView"
        params: dict[str, Any] = {
            "startDateTime": _graph_time(time_min),
            "endDateTime": _graph_time(time_max),
            "$top": _PAGE_SIZE,
            "$orderby": "start/dateTime",
            "$select": _EVENT_SELECT,
        }
        events: list[CalendarEvent] = []
        for _ in range(_MAX_PAGES):
            if url is None:
                break
            data = await self._get_json(url, params=params)
            values = data.get("value") if isinstance(data, dict) else None
            for raw in values or []:
                event = _map_event(raw, tz, calendar_name or calendar_id or "primary")
                if event is not None:
                    events.append(event)
            next_link = data.get("@odata.nextLink") if isinstance(data, dict) else None
            url = str(next_link) if isinstance(next_link, str) and next_link else None
            params = {}  # the nextLink URL embeds the full query
        return events
