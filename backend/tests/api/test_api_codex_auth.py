"""Codex provider status and browser-login API tests."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from starlette.testclient import TestClient

from core.providers.codex import CodexConnectionStatus, CodexLoginStart


def test_codex_auth_status_is_redacted(client: TestClient) -> None:
    with patch(
        "api.routers.providers.codex_connection_status",
        AsyncMock(
            return_value=CodexConnectionStatus(
                installed=True,
                connected=True,
                auth_mode="chatgpt",
                plan_type="plus",
                version="0.142.4",
            )
        ),
    ):
        response = client.get("/api/providers/codex/auth/status")

    assert response.status_code == 200
    assert response.json() == {
        "installed": True,
        "connected": True,
        "auth_mode": "chatgpt",
        "plan_type": "plus",
        "version": "0.142.4",
        "error": None,
    }


def test_codex_login_start_returns_url_and_id_only(client: TestClient) -> None:
    with patch(
        "api.routers.providers.start_codex_login",
        AsyncMock(
            return_value=CodexLoginStart(
                auth_url="https://auth.openai.com/authorize?opaque=yes",
                login_id="login-1",
            )
        ),
    ):
        response = client.post("/api/providers/codex/auth/start", json={})

    assert response.status_code == 200
    assert response.json() == {
        "auth_url": "https://auth.openai.com/authorize?opaque=yes",
        "login_id": "login-1",
    }
    assert "token" not in response.text.lower()
