"""Coverage for the Email Bridge: IMAP adapter parsing, sync orchestration,
cursor behavior, config validation, and the /api/automations/email endpoints."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from starlette.testclient import TestClient

from bridge.email import EmailClient, EmailError, _parse_message, _strip_html
from bridge.email_service import EmailSyncConflictError, EmailSyncService, sync_email
from core.config import (
    CaptureProcessingConfig,
    EmailBridgeConfig,
    GlobalConfig,
    LoomSettings,
)
from core.notes import parse_note
from core.vault import VaultManager

_PLAIN = b"""From: Ada Lovelace <ada@example.com>
Subject: =?utf-8?q?Zigbee_mesh_report?=
Date: Mon, 20 Jul 2026 10:00:00 +0000
Message-ID: <msg-001@example.com>
Content-Type: text/plain; charset="utf-8"

The garage sensor is stable now. Full report attached to the project log.
"""

_HTML = b"""From: Bob <bob@example.com>
Subject: Weekly sync notes
Date: Mon, 20 Jul 2026 11:00:00 +0000
Content-Type: text/html; charset="utf-8"

<html><body><p>Hello <b>team</b>,</p><p>notes inside</p></body></html>
"""

_MULTIPART = b"""From: Carol <carol@example.com>
Subject: Multipart with attachment
Date: Mon, 20 Jul 2026 12:00:00 +0000
Message-ID: <msg-003@example.com>
Content-Type: multipart/mixed; boundary="xyz"

--xyz
Content-Type: text/plain; charset="utf-8"

Plain text part wins.
--xyz
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="data.bin"

binarygarbage
--xyz--
"""


class FakeImap:
    """In-memory IMAP stand-in keyed on UID."""

    def __init__(self, host: str, port: int, messages: dict[int, bytes] | None = None) -> None:
        self.host = host
        self.port = port
        self._messages = dict(messages or {})
        self.logged_out = False

    def set_messages(self, messages: dict[int, bytes]) -> None:
        self._messages = dict(messages)

    def login(self, user: str, password: str):
        if password == "bad":
            raise FakeImap.error("authentication failed")
        return ("OK", [b"logged in"])

    def select(self, mailbox: str, readonly: bool):
        if mailbox == "MISSING":
            return ("NO", [b"no such mailbox"])
        return ("OK", [str(len(self._messages)).encode()])

    def uid(self, command: str, *args: str):
        if command == "SEARCH":
            criteria = args[0]
            if criteria.startswith("UID "):
                lo = int(criteria[4:].split(":")[0])
                ids = sorted(u for u in self._messages if u >= lo)
            else:  # SINCE "date" — the fake ignores the date
                ids = sorted(self._messages)
            return ("OK", [b" ".join(str(i).encode() for i in ids)])
        if command == "FETCH":
            wanted = [int(x) for x in args[0].split(",")]
            parts = []
            for uid in wanted:
                if uid in self._messages:
                    parts.append((f"{uid} (UID {uid}".encode(), self._messages[uid]))
            return ("OK", parts)
        raise AssertionError(f"unexpected command {command}")

    def logout(self):
        self.logged_out = True
        return ("OK", [])

    # imaplib.IMAP4.error stand-in
    class error(Exception):
        pass


def _client(messages: dict[int, bytes]) -> EmailClient:
    box = FakeImap("imap.example.com", 993, messages)
    return EmailClient(
        "imap.example.com",
        993,
        "user@example.com",
        "app-password",
        imap_factory=lambda host, port: box,
    )


class TestEmailParsing:
    def test_plain_message(self) -> None:
        item = _parse_message(_PLAIN, uid=1, folder="INBOX")
        assert item.subject == "Zigbee mesh report"
        assert item.sender == "Ada Lovelace <ada@example.com>"
        assert item.message_id == "msg-001@example.com"
        assert item.external_id == "email:mid:msg-001@example.com"
        assert "stable now" in item.body
        assert "2026-07-20T10:00:00+00:00" in item.date

    def test_html_fallback_is_stripped(self) -> None:
        item = _parse_message(_HTML, uid=2, folder="INBOX")
        assert "Hello team," in item.body
        assert "<p>" not in item.body
        assert item.external_id == "email:uid:INBOX:2"  # no Message-ID header

    def test_multipart_prefers_plain_and_skips_attachments(self) -> None:
        item = _parse_message(_MULTIPART, uid=3, folder="INBOX")
        assert item.body == "Plain text part wins."
        assert "binarygarbage" not in item.body

    def test_strip_html_handles_entities(self) -> None:
        assert _strip_html("<p>a &amp; b&nbsp;c</p>") == "a & b c"

    def test_unparseable_message_never_raises(self) -> None:
        item = _parse_message(b"\x00\xff\x01not an email", uid=9, folder="INBOX")
        assert item.uid == 9


class TestEmailClient:
    @pytest.mark.asyncio
    async def test_fetch_since_filters_and_caps(self) -> None:
        messages = {1: _PLAIN, 2: _HTML, 3: _MULTIPART}
        client = _client(messages)
        async with client:
            items = await client.fetch_since(
                "INBOX", since_uid=1, lookback_start=_lookback(), limit=10
            )
        assert [i.uid for i in items] == [2, 3]

        async with _client(messages) as client2:
            items = await client2.fetch_since(
                "INBOX", since_uid=0, lookback_start=_lookback(), limit=2
            )
        # Fresh cursor keeps only the newest `limit` messages.
        assert [i.uid for i in items] == [2, 3]

    @pytest.mark.asyncio
    async def test_validate_reports_folder(self) -> None:
        async with _client({1: _PLAIN}) as client:
            info = await client.validate("INBOX")
        assert info == {"folder": "INBOX", "messages": 1}

    @pytest.mark.asyncio
    async def test_missing_folder_raises(self) -> None:
        async with _client({1: _PLAIN}) as client:
            with pytest.raises(EmailError, match="MISSING"):
                await client.validate("MISSING")


def _lookback():
    from datetime import UTC, datetime, timedelta

    return datetime.now(UTC) - timedelta(hours=24)


def _email_vault(tmp_path: Path, monkeypatch) -> VaultManager:
    manager = VaultManager(settings=LoomSettings(loom_home=tmp_path / ".loom"))
    manager.init_vault("test")
    manager.set_active_vault("test")
    config = GlobalConfig.load(manager.config_path())
    config.active_vault = "test"
    config.email = EmailBridgeConfig(
        enabled=True,
        host="imap.example.com",
        username="user@example.com",
        password="app-password",
        lookback_hours=48,
        interval_minutes=5,
    )
    config.capture_processing = CaptureProcessingConfig(
        mode="trusted",
        trusted_sources=["bridge:email"],
    )
    config.save(manager.config_path())
    monkeypatch.setattr("bridge.email_service._cursor_path", lambda: tmp_path / "email-sync.json")
    return manager


class TestEmailSyncService:
    @pytest.mark.asyncio
    async def test_sync_ingests_and_is_idempotent(self, tmp_path, monkeypatch) -> None:
        manager = _email_vault(tmp_path, monkeypatch)
        client = _client({1: _PLAIN, 2: _HTML, 3: _MULTIPART})

        first = await sync_email(vm=manager, client=client)
        assert (first["fetched"], first["created"], first["deduplicated"]) == (3, 3, 0)

        captures = sorted((manager.active_vault_dir() / "threads" / "captures").glob("*.md"))
        assert len(captures) == 3
        note = parse_note(captures[0])
        assert note.source == "bridge:email"

        # Same cursor → nothing new to fetch (cursor is the efficiency layer).
        second = await sync_email(vm=manager, client=client)
        assert (second["fetched"], second["created"]) == (0, 0)
        assert json.loads((tmp_path / "email-sync.json").read_text())["last_uid"] == 3

        # Cursor lost (or another client moved it back) → ingress dedup is the
        # correctness backstop: re-listed mail never files twice.
        (tmp_path / "email-sync.json").unlink()
        third = await sync_email(vm=manager, client=client)
        assert (third["fetched"], third["created"], third["deduplicated"]) == (3, 0, 3)

    @pytest.mark.asyncio
    async def test_cursor_limits_next_poll(self, tmp_path, monkeypatch) -> None:
        manager = _email_vault(tmp_path, monkeypatch)
        client = _client({1: _PLAIN, 2: _HTML})
        await sync_email(vm=manager, client=client)

        # Mailbox gains one new message; the next poll sees only that one.
        client2 = _client({1: _PLAIN, 2: _HTML, 3: _MULTIPART})
        second = await sync_email(vm=manager, client=client2)
        assert second["fetched"] == 1
        assert second["created"] == 1

    @pytest.mark.asyncio
    async def test_incomplete_config_raises(self, tmp_path, monkeypatch) -> None:
        manager = _email_vault(tmp_path, monkeypatch)
        config = GlobalConfig.load(manager.config_path())
        config.email.password = None
        config.save(manager.config_path())
        with pytest.raises(EmailError, match="host, username, and password"):
            await sync_email(vm=manager, client=_client({}))


class TestEmailPoller:
    @pytest.mark.asyncio
    async def test_tick_runs_sync_when_enabled(self, monkeypatch) -> None:
        import asyncio

        calls: list[str] = []

        async def _fake_sync() -> dict:
            calls.append("tick")
            return {"synced_at": "2026-07-21T00:00:00Z", "created": 1}

        cfg = GlobalConfig()
        cfg.email = EmailBridgeConfig(
            enabled=True,
            host="imap.example.com",
            username="u",
            password="p",
            interval_minutes=5,
        )
        monkeypatch.setattr(GlobalConfig, "load", classmethod(lambda cls, path: cfg))
        monkeypatch.setattr("bridge.email_service.sync_email", _fake_sync)

        service = EmailSyncService()
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
    async def test_tick_skips_when_disabled(self, monkeypatch) -> None:
        import asyncio

        calls: list[str] = []

        async def _fake_sync() -> dict:
            calls.append("tick")
            return {"synced_at": "", "created": 0}

        monkeypatch.setattr(GlobalConfig, "load", classmethod(lambda cls, path: GlobalConfig()))
        monkeypatch.setattr("bridge.email_service.sync_email", _fake_sync)

        service = EmailSyncService()
        await service.start()
        try:
            await asyncio.sleep(0.15)
            assert calls == []
        finally:
            await service.aclose()


class TestEmailConfig:
    def test_password_encrypted_at_rest(self, tmp_path: Path) -> None:
        cfg = GlobalConfig()
        cfg.email = EmailBridgeConfig(host="imap.example.com", username="u", password="app-pw")
        path = tmp_path / "config.yaml"
        cfg.save(path)
        on_disk = path.read_text(encoding="utf-8")
        assert "app-pw" not in on_disk
        assert "enc:v1:" in on_disk
        assert GlobalConfig.load(path).email.password == "app-pw"

    def test_host_rejects_slashes(self) -> None:
        with pytest.raises(ValueError):
            EmailBridgeConfig(host="https://imap.example.com")

    def test_blank_password_normalizes_to_none(self) -> None:
        assert EmailBridgeConfig(password="").password is None


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------


def _init(vault_manager) -> Path:
    vault_manager.init_vault("test")
    vault_manager.set_active_vault("test")
    return vault_manager.active_vault_dir()


class TestEmailApi:
    def test_get_defaults_are_redacted(self, client: TestClient, vault_manager) -> None:
        _init(vault_manager)
        response = client.get("/api/automations/email")
        assert response.status_code == 200
        body = response.json()
        assert body["email"]["enabled"] is False
        assert body["email"]["password_set"] is False
        assert "password" not in body["email"]

    def test_patch_persists_and_encrypts(self, client: TestClient, vault_manager) -> None:
        _init(vault_manager)
        response = client.patch(
            "/api/automations/email",
            json={
                "enabled": True,
                "host": "imap.example.com",
                "username": "user@example.com",
                "password": "app-pw",
                "interval_minutes": 30,
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["email"]["enabled"] is True
        assert body["email"]["password_set"] is True
        persisted = vault_manager.config_path().read_text(encoding="utf-8")
        assert "app-pw" not in persisted
        assert GlobalConfig.load(vault_manager.config_path()).email.password == "app-pw"

    def test_patch_rejects_incomplete_enable(self, client: TestClient, vault_manager) -> None:
        _init(vault_manager)
        response = client.patch("/api/automations/email", json={"enabled": True})
        assert response.status_code == 422

    def test_test_endpoint_success_and_failure(self, client: TestClient, vault_manager) -> None:
        _init(vault_manager)
        client.patch(
            "/api/automations/email",
            json={
                "host": "imap.example.com",
                "username": "u",
                "password": "app-pw",
            },
        )

        class _OkClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return None

            async def validate(self, folder: str) -> dict:
                return {"folder": folder, "messages": 7}

        with patch("api.routers.email_bridge.EmailClient", return_value=_OkClient()):
            response = client.post("/api/automations/email/test")
        assert response.status_code == 200
        assert response.json() == {"ok": True, "folder": "INBOX", "messages": 7, "error": ""}

        class _FailClient(_OkClient):
            async def validate(self, folder: str) -> dict:
                raise EmailError("Cannot reach IMAP host")

        with patch("api.routers.email_bridge.EmailClient", return_value=_FailClient()):
            response = client.post("/api/automations/email/test")
        assert response.json()["ok"] is False
        assert "Cannot reach" in response.json()["error"]

    def test_sync_endpoint_and_conflict(self, client: TestClient, vault_manager) -> None:
        _init(vault_manager)
        client.patch(
            "/api/automations/email",
            json={"host": "imap.example.com", "username": "u", "password": "p"},
        )
        payload = {
            "synced_at": "2026-07-21T00:00:00Z",
            "folder": "INBOX",
            "fetched": 2,
            "created": 2,
            "deduplicated": 0,
            "capture_ids": ["thr_a", "thr_b"],
        }
        with patch("api.routers.email_bridge.sync_email", return_value=payload):
            response = client.post("/api/automations/email/sync")
        assert response.status_code == 200
        assert response.json()["created"] == 2

        async def _boom(**kwargs):
            raise EmailSyncConflictError("The active vault changed; retry email sync")

        with patch("api.routers.email_bridge.sync_email", side_effect=_boom):
            response = client.post("/api/automations/email/sync")
        assert response.status_code == 409
