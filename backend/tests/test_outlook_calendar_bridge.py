"""Coverage for the Outlook Calendar OAuth bridge: authorization URL, token
lifecycle (exchange/refresh/revoked), Graph event mapping, sync orchestration,
the encrypted token store, config validation, and the
/api/automations/calendar/outlook endpoints."""

from __future__ import annotations

import json
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from starlette.testclient import TestClient

import bridge.oauth as oauth
from bridge.calendar import CalendarEvent
from bridge.oauth import OAuthTokens
from bridge.outlook_cal import (
    OutlookCalendarAuthError,
    OutlookCalendarClient,
    OutlookCalendarError,
    authorization_url,
)
from bridge.outlook_cal_service import (
    OutlookCalendarSyncConflictError,
    OutlookCalendarSyncService,
    clear_outlook_connection,
    load_outlook_tokens,
    save_outlook_tokens,
    sync_outlook_calendar,
)
from core.config import (
    CaptureProcessingConfig,
    GlobalConfig,
    LoomSettings,
    OutlookCalendarConfig,
)
from core.notes import parse_note
from core.vault import VaultManager

_LOOPBACK_HEADERS = {"Host": "localhost"}


@pytest.fixture(autouse=True)
def _clear_flow_states():
    oauth.reset_flow_states()
    yield
    oauth.reset_flow_states()


def _tokens(*, fresh: bool = True, account: str = "ada@outlook.com") -> OAuthTokens:
    return OAuthTokens(
        access_token="msft.access-token",
        refresh_token="0.msft-refresh-token",
        expires_at=time.time() + (3600 if fresh else -3600),
        account=account,
    )


def _http(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler), trust_env=False)


def _client(handler, *, tokens: OAuthTokens | None = None) -> OutlookCalendarClient:
    return OutlookCalendarClient(
        client_id="client-id",
        client_secret="client-secret",
        tokens=tokens,
        http=_http(handler),
    )


class TestOutlookAuthorizationUrl:
    def test_consent_url_shape(self) -> None:
        url = authorization_url(
            client_id="client-id",
            redirect_uri="http://localhost:8000/api/automations/calendar/outlook/callback",
            state="state-123",
        )
        parsed = urlparse(url)
        query = parse_qs(parsed.query)
        assert parsed.scheme == "https"
        assert parsed.netloc == "login.microsoftonline.com"
        assert parsed.path == "/common/oauth2/v2.0/authorize"
        assert query["client_id"] == ["client-id"]
        assert query["redirect_uri"] == [
            "http://localhost:8000/api/automations/calendar/outlook/callback"
        ]
        assert query["response_type"] == ["code"]
        assert query["response_mode"] == ["query"]
        assert query["scope"] == ["offline_access Calendars.Read"]
        assert query["state"] == ["state-123"]


class TestOutlookTokenLifecycle:
    @pytest.mark.asyncio
    async def test_exchange_code_posts_form_and_maps_tokens(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            assert request.url.host == "login.microsoftonline.com"
            assert request.url.path == "/common/oauth2/v2.0/token"
            form = parse_qs(request.content.decode())
            assert form["grant_type"] == ["authorization_code"]
            assert form["code"] == ["auth-code"]
            assert form["scope"] == ["offline_access Calendars.Read"]
            return httpx.Response(
                200,
                json={
                    "access_token": "msft.new",
                    "refresh_token": "0.new-refresh",
                    "expires_in": 3599,
                    "token_type": "Bearer",
                },
            )

        client = _client(handler)
        tokens = await client.exchange_code(
            "auth-code", redirect_uri="http://localhost:8000/callback"
        )
        assert tokens.access_token == "msft.new"
        assert tokens.refresh_token == "0.new-refresh"
        assert tokens.access_token_fresh()

    @pytest.mark.asyncio
    async def test_fresh_access_token_skips_refresh(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            raise AssertionError("no HTTP call expected for a fresh token")

        client = _client(handler, tokens=_tokens(fresh=True))
        tokens = await client.ensure_fresh_token()
        assert tokens.access_token == "msft.access-token"

    @pytest.mark.asyncio
    async def test_expired_token_refreshes_and_rotates_refresh(self) -> None:
        saved: list[OAuthTokens] = []

        def handler(request: httpx.Request) -> httpx.Response:
            form = parse_qs(request.content.decode())
            assert form["grant_type"] == ["refresh_token"]
            assert form["refresh_token"] == ["0.msft-refresh-token"]
            return httpx.Response(
                200,
                json={
                    "access_token": "msft.refreshed",
                    # Microsoft rotates refresh tokens — the new one must win.
                    "refresh_token": "0.rotated-refresh",
                    "expires_in": 3600,
                },
            )

        client = _client(handler, tokens=_tokens(fresh=False))
        client._on_tokens = saved.append
        tokens = await client.ensure_fresh_token()
        assert tokens.access_token == "msft.refreshed"
        assert tokens.refresh_token == "0.rotated-refresh"
        assert tokens.account == "ada@outlook.com"
        assert saved == [tokens]

    @pytest.mark.asyncio
    async def test_revoked_refresh_raises_auth_error(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                400,
                json={
                    "error": "invalid_grant",
                    "error_description": "The user has revoked access.",
                },
            )

        client = _client(handler, tokens=_tokens(fresh=False))
        with pytest.raises(OutlookCalendarAuthError, match="revoked"):
            await client.ensure_fresh_token()


_EVENTS_PAGE = {
    "value": [
        {
            "id": "AAMk-event-1",
            "subject": "Design review",
            "type": "singleInstance",
            "isAllDay": False,
            "isCancelled": False,
            "start": {"dateTime": "2026-07-20T15:00:00.0000000", "timeZone": "UTC"},
            "end": {"dateTime": "2026-07-20T16:00:00.0000000", "timeZone": "UTC"},
            "location": {"displayName": "Room 4"},
            "bodyPreview": "Quarterly roadmap",
            "webLink": "https://outlook.office365.com/owa/?itemid=abc",
            "attendees": [
                {"emailAddress": {"name": "Ada", "address": "ada@outlook.com"}},
                {"emailAddress": {"name": "", "address": "bob@example.com"}},
            ],
        },
        {
            "id": "AAMk-event-2",
            "subject": "Conference",
            "type": "singleInstance",
            "isAllDay": True,
            "isCancelled": False,
            "start": {"dateTime": "2026-07-21T00:00:00.0000000", "timeZone": "UTC"},
            "end": {"dateTime": "2026-07-23T00:00:00.0000000", "timeZone": "UTC"},
            "location": {"displayName": ""},
            "bodyPreview": "",
            "webLink": "",
            "attendees": [],
        },
        {
            "id": "AAMk-event-3",
            "subject": "Cancelled standup",
            "type": "singleInstance",
            "isAllDay": False,
            "isCancelled": True,
            "start": {"dateTime": "2026-07-20T17:00:00.0000000", "timeZone": "UTC"},
            "end": {"dateTime": "2026-07-20T17:30:00.0000000", "timeZone": "UTC"},
        },
        {
            "id": "AAMk-series-occurrence-20260722",
            "subject": "Weekly sync",
            "type": "occurrence",
            "seriesMasterId": "AAMk-series-master",
            "isAllDay": False,
            "isCancelled": False,
            "start": {"dateTime": "2026-07-22T15:00:00.0000000", "timeZone": "UTC"},
            "end": {"dateTime": "2026-07-22T15:30:00.0000000", "timeZone": "UTC"},
        },
    ]
}


class TestOutlookEventListing:
    @pytest.mark.asyncio
    async def test_calendar_view_maps_events(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            assert request.url.path == "/v1.0/me/calendarView"
            params = request.url.params
            assert "startDateTime" in params and "endDateTime" in params
            assert params["$orderby"] == "start/dateTime"
            assert request.headers["authorization"] == "Bearer msft.access-token"
            assert request.headers["prefer"] == 'outlook.timezone="UTC"'
            return httpx.Response(200, json=_EVENTS_PAGE)

        client = _client(handler, tokens=_tokens())
        events = await client.list_events(
            "primary",
            time_min=datetime(2026, 7, 19, tzinfo=UTC),
            time_max=datetime(2026, 7, 27, tzinfo=UTC),
            default_tz="America/Chicago",
        )
        assert [event.uid for event in events] == [
            "AAMk-event-1",
            "AAMk-event-2",
            "AAMk-series-occurrence-20260722",
        ]

        timed = events[0]
        assert timed.title == "Design review"
        assert timed.start.isoformat() == "2026-07-20T15:00:00+00:00"
        assert timed.all_day is False
        assert timed.location == "Room 4"
        assert timed.attendees == ("Ada", "bob@example.com")
        assert timed.url == "https://outlook.office365.com/owa/?itemid=abc"
        assert timed.description == "Quarterly roadmap"
        assert timed.calendar_name == "primary"

        all_day = events[1]
        assert all_day.all_day is True
        # All-day events localize to the vault timezone like the iCal bridge.
        assert all_day.start.tzinfo == ZoneInfo("America/Chicago")
        assert all_day.start.date().isoformat() == "2026-07-21"

        occurrence = events[2]
        assert occurrence.recurrence_id == occurrence.start

    @pytest.mark.asyncio
    async def test_explicit_calendar_id_uses_calendars_path(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            assert request.url.path == "/v1.0/me/calendars/AAMk-calendar-9/calendarView"
            return httpx.Response(200, json={"value": []})

        client = _client(handler, tokens=_tokens())
        events = await client.list_events(
            "AAMk-calendar-9",
            time_min=datetime(2026, 7, 19, tzinfo=UTC),
            time_max=datetime(2026, 7, 27, tzinfo=UTC),
        )
        assert events == []

    @pytest.mark.asyncio
    async def test_pagination_follows_next_link(self) -> None:
        pages: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            pages.append(str(request.url))
            if "$skip" not in str(request.url):
                return httpx.Response(
                    200,
                    json={
                        "value": [_EVENTS_PAGE["value"][0]],
                        "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendarView?$skip=50",
                    },
                )
            return httpx.Response(200, json={"value": [_EVENTS_PAGE["value"][1]]})

        client = _client(handler, tokens=_tokens())
        events = await client.list_events(
            "primary",
            time_min=datetime(2026, 7, 19, tzinfo=UTC),
            time_max=datetime(2026, 7, 27, tzinfo=UTC),
        )
        assert len(pages) == 2
        assert [event.uid for event in events] == ["AAMk-event-1", "AAMk-event-2"]

    @pytest.mark.asyncio
    async def test_fetch_account_uses_me(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            assert request.url.path == "/v1.0/me"
            return httpx.Response(200, json={"mail": None, "userPrincipalName": "ada@outlook.com"})

        client = _client(handler, tokens=_tokens())
        assert await client.fetch_account() == "ada@outlook.com"

    @pytest.mark.asyncio
    async def test_401_raises_auth_error(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(401, json={"error": {"code": "InvalidAuthenticationToken"}})

        client = _client(handler, tokens=_tokens())
        with pytest.raises(OutlookCalendarAuthError, match="rejected"):
            await client.list_events(
                "primary",
                time_min=datetime(2026, 7, 19, tzinfo=UTC),
                time_max=datetime(2026, 7, 27, tzinfo=UTC),
            )


def _event(uid: str, title: str) -> CalendarEvent:
    tz = ZoneInfo("America/Chicago")
    start = datetime(2026, 7, 20, 10, 0, tzinfo=tz)
    return CalendarEvent(
        uid=uid,
        title=title,
        start=start,
        end=start + timedelta(hours=1),
        all_day=False,
        calendar_name="primary",
    )


class _FakeOutlookClient:
    """Stand-in for OutlookCalendarClient serving canned events per calendar."""

    def __init__(
        self,
        events_by_calendar: dict[str, Any],
        *,
        auth_error: Exception | None = None,
    ) -> None:
        self.events_by_calendar = events_by_calendar
        self.auth_error = auth_error
        self.calls: list[str] = []

    async def ensure_fresh_token(self) -> OAuthTokens:
        if self.auth_error is not None:
            raise self.auth_error
        return _tokens()

    async def list_events(
        self,
        calendar_id: str,
        *,
        time_min: datetime,
        time_max: datetime,
        default_tz: str = "UTC",
        calendar_name: str = "",
    ) -> list[CalendarEvent]:
        self.calls.append(calendar_id)
        entry = self.events_by_calendar.get(calendar_id, [])
        if isinstance(entry, Exception):
            raise entry
        return entry

    async def aclose(self) -> None:
        return None


def _outlook_vault(
    tmp_path: Path,
    monkeypatch,
    *,
    calendar_ids: list[str] | None = None,
) -> VaultManager:
    """Real vault + config with the bridge connected; state files patched to tmp."""
    manager = VaultManager(settings=LoomSettings(loom_home=tmp_path / ".loom"))
    manager.init_vault("test")
    manager.set_active_vault("test")
    config = GlobalConfig.load(manager.config_path())
    config.active_vault = "test"
    config.outlook_calendar = OutlookCalendarConfig(
        enabled=True,
        client_id="client-id",
        client_secret="client-secret",
        lookback_days=7,
        interval_minutes=5,
        calendar_ids=calendar_ids or [],
    )
    config.capture_processing = CaptureProcessingConfig(
        mode="trusted",
        trusted_sources=["bridge:outlook-cal"],
    )
    config.save(manager.config_path())
    monkeypatch.setattr(
        "bridge.outlook_cal_service._cursor_path", lambda: tmp_path / "outlook-cal-sync.json"
    )
    monkeypatch.setattr(
        "bridge.outlook_cal_service._tokens_path", lambda: tmp_path / "outlook-cal-oauth.json"
    )
    save_outlook_tokens(_tokens())
    return manager


class TestOutlookCalendarSync:
    @pytest.mark.asyncio
    async def test_sync_ingests_and_is_idempotent(self, tmp_path, monkeypatch) -> None:
        manager = _outlook_vault(tmp_path, monkeypatch)
        events = [
            _event("AAMk-event-1", "Design review"),
            _event("AAMk-event-2", "1:1 with manager"),
        ]
        client = _FakeOutlookClient({"primary": events})

        first = await sync_outlook_calendar(vm=manager, client=client)  # type: ignore[arg-type]
        assert (first["created"], first["deduplicated"], first["errors"]) == (2, 0, 0)
        assert first["calendars"][0]["fetched"] == 2

        captures_dir = manager.active_vault_dir() / "threads" / "captures"
        captures = sorted(captures_dir.glob("*.md"))
        assert len(captures) == 2
        note = parse_note(captures[0])
        assert note.source == "bridge:outlook-cal"
        assert note.extra["external_id"].startswith("outlook-cal:primary:AAMk-")

        # The window re-lists every poll; ingress dedup keeps it duplicate-free.
        second = await sync_outlook_calendar(vm=manager, client=client)  # type: ignore[arg-type]
        assert (second["created"], second["deduplicated"]) == (0, 2)
        assert len(list(captures_dir.glob("*.md"))) == 2

        cursors = json.loads((tmp_path / "outlook-cal-sync.json").read_text(encoding="utf-8"))
        assert cursors["calendars"]["primary"]["synced_at"]

    @pytest.mark.asyncio
    async def test_one_calendar_failure_is_isolated(self, tmp_path, monkeypatch) -> None:
        manager = _outlook_vault(tmp_path, monkeypatch, calendar_ids=["bad-cal", "good-cal"])
        client = _FakeOutlookClient(
            {
                "bad-cal": OutlookCalendarError("Calendar not found or not accessible"),
                "good-cal": [_event("AAMk-event-9", "Focus time")],
            }
        )
        result = await sync_outlook_calendar(vm=manager, client=client)  # type: ignore[arg-type]
        assert result["errors"] == 1
        assert result["calendars"][0]["calendar"] == "bad-cal"
        assert "not found" in result["calendars"][0]["error"].lower()
        assert result["calendars"][1]["error"] == ""
        assert result["created"] == 1

    @pytest.mark.asyncio
    async def test_revoked_grant_fails_upfront(self, tmp_path, monkeypatch) -> None:
        manager = _outlook_vault(tmp_path, monkeypatch)
        client = _FakeOutlookClient(
            {},
            auth_error=OutlookCalendarAuthError(
                "Microsoft sign-in was revoked — reconnect your account in Settings"
            ),
        )
        with pytest.raises(OutlookCalendarAuthError, match="revoked"):
            await sync_outlook_calendar(vm=manager, client=client)  # type: ignore[arg-type]

    @pytest.mark.asyncio
    async def test_missing_tokens_raise_connect_first(self, tmp_path, monkeypatch) -> None:
        manager = _outlook_vault(tmp_path, monkeypatch)
        clear_outlook_connection()
        with pytest.raises(OutlookCalendarError, match="Connect your Outlook account"):
            await sync_outlook_calendar(vm=manager, client=_FakeOutlookClient({}))  # type: ignore[arg-type]


class TestOutlookCalendarPoller:
    @pytest.mark.asyncio
    async def test_tick_runs_sync_when_enabled(self, monkeypatch, tmp_path) -> None:
        import asyncio

        calls: list[str] = []

        async def _fake_sync() -> dict:
            calls.append("tick")
            return {"synced_at": "2026-07-21T00:00:00Z", "created": 1, "errors": 0}

        cfg = GlobalConfig()
        cfg.outlook_calendar = OutlookCalendarConfig(
            enabled=True,
            client_id="client-id",
            client_secret="client-secret",
            interval_minutes=5,
        )
        monkeypatch.setattr(GlobalConfig, "load", classmethod(lambda cls, path: cfg))
        monkeypatch.setattr("bridge.outlook_cal_service.sync_outlook_calendar", _fake_sync)
        monkeypatch.setattr(
            "bridge.outlook_cal_service._tokens_path", lambda: tmp_path / "outlook-cal-oauth.json"
        )
        save_outlook_tokens(_tokens())

        service = OutlookCalendarSyncService()
        await service.start()
        try:
            for _ in range(50):
                if calls:
                    break
                await asyncio.sleep(0.02)
            assert calls == ["tick"]
            assert service.status()["last_created"] == 1
        finally:
            await service.aclose()

    @pytest.mark.asyncio
    async def test_tick_skips_when_disabled_or_disconnected(self, monkeypatch, tmp_path) -> None:
        import asyncio

        calls: list[str] = []

        async def _fake_sync() -> dict:
            calls.append("tick")
            return {"synced_at": "", "created": 0, "errors": 0}

        monkeypatch.setattr(GlobalConfig, "load", classmethod(lambda cls, path: GlobalConfig()))
        monkeypatch.setattr("bridge.outlook_cal_service.sync_outlook_calendar", _fake_sync)
        monkeypatch.setattr(
            "bridge.outlook_cal_service._tokens_path", lambda: tmp_path / "outlook-cal-oauth.json"
        )

        service = OutlookCalendarSyncService()
        await service.start()
        try:
            await asyncio.sleep(0.15)
            assert calls == []
        finally:
            await service.aclose()


class TestOutlookCalendarConfig:
    def test_client_secret_encrypted_at_rest(self, tmp_path: Path) -> None:
        cfg = GlobalConfig()
        cfg.outlook_calendar = OutlookCalendarConfig(
            client_id="client-id", client_secret="msft-secret"
        )
        path = tmp_path / "config.yaml"
        cfg.save(path)
        on_disk = path.read_text(encoding="utf-8")
        assert "msft-secret" not in on_disk
        assert "enc:v1:" in on_disk
        loaded = GlobalConfig.load(path)
        assert loaded.outlook_calendar.client_secret == "msft-secret"
        public = loaded.outlook_calendar.to_public()
        assert public.client_secret_set is True
        assert not hasattr(public, "client_secret")

    def test_client_id_rejects_whitespace(self) -> None:
        with pytest.raises(ValueError):
            OutlookCalendarConfig(client_id="bad client id")


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------


def _init(vault_manager) -> Path:
    vault_manager.init_vault("test")
    vault_manager.set_active_vault("test")
    return vault_manager.active_vault_dir()


def _patch_state_files(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(
        "bridge.outlook_cal_service._cursor_path", lambda: tmp_path / "outlook-cal-sync.json"
    )
    monkeypatch.setattr(
        "bridge.outlook_cal_service._tokens_path", lambda: tmp_path / "outlook-cal-oauth.json"
    )


def _mock_outlook_http(monkeypatch, handler) -> None:
    real_async_client = httpx.AsyncClient

    def fake_async_client(**kwargs: Any) -> httpx.AsyncClient:
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_async_client(**kwargs)

    monkeypatch.setattr("bridge.outlook_cal.httpx.AsyncClient", fake_async_client)


def _connect_config(client: TestClient) -> None:
    response = client.patch(
        "/api/automations/calendar/outlook",
        json={"client_id": "client-id", "client_secret": "msft-secret"},
    )
    assert response.status_code == 200


def _start_connect(client: TestClient) -> str:
    response = client.post("/api/automations/calendar/outlook/connect", headers=_LOOPBACK_HEADERS)
    assert response.status_code == 200
    url = response.json()["authorization_url"]
    return parse_qs(urlparse(url).query)["state"][0]


class TestOutlookCalendarApi:
    def test_get_defaults_are_redacted(self, client: TestClient, vault_manager) -> None:
        _init(vault_manager)
        response = client.get("/api/automations/calendar/outlook")
        assert response.status_code == 200
        body = response.json()
        assert body["outlook"]["enabled"] is False
        assert body["outlook"]["client_secret_set"] is False
        assert "client_secret" not in body["outlook"]
        assert body["connection"] == {"connected": False, "account": ""}

    def test_patch_persists_and_encrypts(self, client: TestClient, vault_manager) -> None:
        _init(vault_manager)
        response = client.patch(
            "/api/automations/calendar/outlook",
            json={
                "client_id": "client-id",
                "client_secret": "msft-secret",
                "interval_minutes": 30,
                "lookback_days": 14,
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["outlook"]["client_secret_set"] is True
        assert body["outlook"]["lookback_days"] == 14
        persisted = vault_manager.config_path().read_text(encoding="utf-8")
        assert "msft-secret" not in persisted
        loaded = GlobalConfig.load(vault_manager.config_path())
        assert loaded.outlook_calendar.client_secret == "msft-secret"

    def test_patch_rejects_enabled_without_credentials(
        self, client: TestClient, vault_manager
    ) -> None:
        _init(vault_manager)
        response = client.patch("/api/automations/calendar/outlook", json={"enabled": True})
        assert response.status_code == 422

    def test_connect_requires_app_credentials(self, client: TestClient, vault_manager) -> None:
        _init(vault_manager)
        response = client.post(
            "/api/automations/calendar/outlook/connect", headers=_LOOPBACK_HEADERS
        )
        assert response.status_code == 409

    def test_connect_returns_consent_url_with_state(
        self, client: TestClient, vault_manager
    ) -> None:
        _init(vault_manager)
        _connect_config(client)
        response = client.post(
            "/api/automations/calendar/outlook/connect", headers=_LOOPBACK_HEADERS
        )
        assert response.status_code == 200
        body = response.json()
        parsed = urlparse(body["authorization_url"])
        query = parse_qs(parsed.query)
        assert parsed.netloc == "login.microsoftonline.com"
        assert query["redirect_uri"] == [
            "http://localhost/api/automations/calendar/outlook/callback"
        ]
        assert query["state"]
        assert body["expires_in"] == 600

    def test_connect_rejects_non_loopback_origin(self, client: TestClient, vault_manager) -> None:
        _init(vault_manager)
        _connect_config(client)
        response = client.post("/api/automations/calendar/outlook/connect")
        assert response.status_code == 400
        assert "loopback" in response.json()["detail"]

    def test_callback_rejects_bad_state_without_exchange(
        self, client: TestClient, vault_manager, monkeypatch
    ) -> None:
        _init(vault_manager)
        _connect_config(client)
        calls = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            return httpx.Response(200, json={"access_token": "must-not-be-used"})

        _mock_outlook_http(monkeypatch, handler)
        response = client.get(
            "/api/automations/calendar/outlook/callback",
            params={"state": "not-a-real-flow", "code": "auth-code"},
            headers=_LOOPBACK_HEADERS,
        )
        assert response.status_code == 400
        assert "auth-code" not in response.text
        assert calls == 0

    def test_callback_success_stores_tokens_encrypted_and_blocks_replay(
        self, client: TestClient, vault_manager, tmp_path, monkeypatch
    ) -> None:
        _init(vault_manager)
        _connect_config(client)
        _patch_state_files(tmp_path, monkeypatch)
        state = _start_connect(client)

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.host == "login.microsoftonline.com":
                form = parse_qs(request.content.decode())
                assert form["code"] == ["one-time-code"]
                return httpx.Response(
                    200,
                    json={
                        "access_token": "msft.access-token",
                        "refresh_token": "0.msft-refresh-token",
                        "expires_in": 3600,
                    },
                )
            assert request.url.path == "/v1.0/me"
            return httpx.Response(200, json={"mail": "ada@outlook.com"})

        _mock_outlook_http(monkeypatch, handler)
        response = client.get(
            "/api/automations/calendar/outlook/callback",
            params={"state": state, "code": "one-time-code"},
            headers=_LOOPBACK_HEADERS,
        )
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert "connected" in response.text.lower()
        assert "one-time-code" not in response.text
        assert "msft.access-token" not in response.text

        on_disk = (tmp_path / "outlook-cal-oauth.json").read_text(encoding="utf-8")
        assert "msft.access-token" not in on_disk
        assert "0.msft-refresh-token" not in on_disk
        tokens = load_outlook_tokens()
        assert tokens is not None
        assert tokens.access_token == "msft.access-token"
        assert tokens.account == "ada@outlook.com"

        status = client.get("/api/automations/calendar/outlook")
        assert status.json()["connection"] == {"connected": True, "account": "ada@outlook.com"}
        assert "msft.access-token" not in status.text
        assert "0.msft-refresh-token" not in status.text

        replay = client.get(
            "/api/automations/calendar/outlook/callback",
            params={"state": state, "code": "one-time-code"},
            headers=_LOOPBACK_HEADERS,
        )
        assert replay.status_code == 400

    def test_disconnect_wipes_tokens_and_cursors(
        self, client: TestClient, vault_manager, tmp_path, monkeypatch
    ) -> None:
        _init(vault_manager)
        _connect_config(client)
        _patch_state_files(tmp_path, monkeypatch)
        save_outlook_tokens(_tokens())
        (tmp_path / "outlook-cal-sync.json").write_text('{"calendars": {"primary": {}}}')

        response = client.post("/api/automations/calendar/outlook/disconnect")
        assert response.status_code == 200
        body = response.json()
        assert body["outlook"]["enabled"] is False
        assert body["connection"] == {"connected": False, "account": ""}
        assert load_outlook_tokens() is None
        assert json.loads((tmp_path / "outlook-cal-sync.json").read_text()) == {"calendars": {}}

    def test_test_endpoint_reports_account_and_errors(
        self, client: TestClient, vault_manager, tmp_path, monkeypatch
    ) -> None:
        _init(vault_manager)
        _connect_config(client)
        _patch_state_files(tmp_path, monkeypatch)

        missing = client.post("/api/automations/calendar/outlook/test")
        assert missing.status_code == 409

        save_outlook_tokens(_tokens())

        class _OkClient:
            def __init__(self, **kwargs: Any) -> None:
                pass

            async def ensure_fresh_token(self) -> OAuthTokens:
                return _tokens()

            async def fetch_account(self) -> str:
                return "ada@outlook.com"

            async def aclose(self) -> None:
                return None

        with patch("api.routers.calendar_outlook.OutlookCalendarClient", _OkClient):
            response = client.post("/api/automations/calendar/outlook/test")
        assert response.status_code == 200
        assert response.json() == {"ok": True, "account": "ada@outlook.com", "error": ""}

        class _RevokedClient(_OkClient):
            async def ensure_fresh_token(self) -> OAuthTokens:
                raise OutlookCalendarAuthError(
                    "Microsoft sign-in was revoked — reconnect your account in Settings"
                )

        with patch("api.routers.calendar_outlook.OutlookCalendarClient", _RevokedClient):
            response = client.post("/api/automations/calendar/outlook/test")
        assert response.json()["ok"] is False
        assert "revoked" in response.json()["error"]

    def test_sync_endpoint_and_conflict(
        self, client: TestClient, vault_manager, tmp_path, monkeypatch
    ) -> None:
        _init(vault_manager)
        _connect_config(client)
        _patch_state_files(tmp_path, monkeypatch)

        missing = client.post("/api/automations/calendar/outlook/sync")
        assert missing.status_code == 409

        save_outlook_tokens(_tokens())
        payload = {
            "synced_at": "2026-07-21T00:00:00Z",
            "calendars": [
                {
                    "calendar": "primary",
                    "fetched": 2,
                    "created": 2,
                    "deduplicated": 0,
                    "error": "",
                }
            ],
            "created": 2,
            "deduplicated": 0,
            "errors": 0,
        }
        with patch("api.routers.calendar_outlook.sync_outlook_calendar", return_value=payload):
            response = client.post("/api/automations/calendar/outlook/sync")
        assert response.status_code == 200
        assert response.json()["created"] == 2

        async def _boom(**kwargs: Any) -> None:
            raise OutlookCalendarSyncConflictError("The active vault changed; retry calendar sync")

        with patch("api.routers.calendar_outlook.sync_outlook_calendar", side_effect=_boom):
            response = client.post("/api/automations/calendar/outlook/sync")
        assert response.status_code == 409
