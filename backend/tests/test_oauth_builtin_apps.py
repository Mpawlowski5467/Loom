"""One-click connect: Loom's built-in OAuth apps, PKCE, and token-app binding.

A built-in app is configured with ``LOOM_*_CLIENT_ID`` settings so users can
connect without registering their own. These tests pin the rules: the user's
own app wins when configured, a flow finishes with the app it started with,
tokens remember the app that issued them, and every flow uses PKCE.
"""

import base64
import hashlib
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from starlette.testclient import TestClient

from bridge.google import google_app_for, load_google_tokens
from bridge.oauth import OAuthTokens, load_tokens, pkce_pair, save_tokens
from bridge.oauth_apps import OAuthApp, app_for_tokens, choose_app
from bridge.outlook_cal_service import load_outlook_tokens
from core.config import GoogleConnectorConfig, settings
from tests import test_google_connector as google_tests
from tests import test_outlook_calendar_bridge as outlook_tests

BUILTIN_GOOGLE = ("builtin-google-id.apps.googleusercontent.com", "builtin-desktop-secret")
BUILTIN_MICROSOFT = "11111111-2222-3333-4444-555555555555"

CUSTOM = OAuthApp("custom-id", "custom-secret", builtin=False)
BUILTIN = OAuthApp("builtin-id", "", builtin=True)


@pytest.fixture()
def builtin_google(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "google_client_id", BUILTIN_GOOGLE[0])
    monkeypatch.setattr(settings, "google_client_secret", BUILTIN_GOOGLE[1])


@pytest.fixture()
def builtin_microsoft(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "microsoft_client_id", BUILTIN_MICROSOFT)


def _challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def _query(url: str) -> dict[str, list[str]]:
    return parse_qs(urlparse(url).query)


# ---------------------------------------------------------------------------
# Plumbing
# ---------------------------------------------------------------------------


def test_pkce_pair_uses_s256() -> None:
    verifier, challenge = pkce_pair()
    assert 43 <= len(verifier) <= 128
    assert challenge == _challenge(verifier)
    assert pkce_pair()[0] != verifier


def test_users_own_app_wins_over_builtin() -> None:
    assert choose_app(CUSTOM, BUILTIN) is CUSTOM
    assert choose_app(None, BUILTIN) is BUILTIN
    assert choose_app(None, None) is None


def test_tokens_refresh_with_the_app_that_issued_them() -> None:
    def tokens(client_id: str) -> OAuthTokens:
        return OAuthTokens("a", "r", 0.0, client_id=client_id)

    assert app_for_tokens(tokens("builtin-id"), CUSTOM, BUILTIN) is BUILTIN
    assert app_for_tokens(tokens("custom-id"), CUSTOM, BUILTIN) is CUSTOM
    # Saved before the issuer was recorded: only custom apps existed then.
    assert app_for_tokens(tokens(""), CUSTOM, BUILTIN) is CUSTOM
    # The issuing app is gone: the caller must ask the user to reconnect.
    assert app_for_tokens(tokens("deleted-id"), CUSTOM, BUILTIN) is None


def test_token_file_keeps_the_issuing_client_id(tmp_path) -> None:
    path = tmp_path / "tokens.json"
    save_tokens(path, OAuthTokens("a", "r", 1.0, client_id="builtin-id"))
    loaded = load_tokens(path)
    assert loaded is not None
    assert loaded.client_id == "builtin-id"


def test_google_refresh_uses_builtin_even_after_custom_app_added(builtin_google) -> None:
    connector = GoogleConnectorConfig(client_id="custom-id", client_secret="custom-secret")
    tokens = OAuthTokens("a", "r", 0.0, client_id=BUILTIN_GOOGLE[0])
    app = google_app_for(connector, tokens)
    assert app is not None
    assert (app.client_id, app.builtin) == (BUILTIN_GOOGLE[0], True)


# ---------------------------------------------------------------------------
# Google: connect with no app of the user's own
# ---------------------------------------------------------------------------


def _google_token_handler(seen: dict[str, list[str]]):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "oauth2.googleapis.com":
            seen.update(parse_qs(request.content.decode()))
            return httpx.Response(
                200,
                json={"access_token": "ya29.a", "refresh_token": "1//r", "expires_in": 3600},
            )
        return httpx.Response(200, json={"emailAddress": "ada@gmail.com"})

    return handler


def test_google_one_click_connect_uses_builtin_app_with_pkce(
    client: TestClient, vault_manager, tmp_path, monkeypatch, builtin_google
) -> None:
    google_tests._init(vault_manager)
    google_tests._patch_state_files(tmp_path, monkeypatch)
    assert client.get("/api/automations/google").json()["builtin_app"] is True

    started = client.post("/api/automations/google/connect", headers={"Host": "localhost"})
    assert started.status_code == 200
    query = _query(started.json()["authorization_url"])
    assert query["client_id"] == [BUILTIN_GOOGLE[0]]
    assert query["code_challenge_method"] == ["S256"]

    seen: dict[str, list[str]] = {}
    google_tests._mock_google_http(monkeypatch, _google_token_handler(seen))
    done = client.get(
        "/api/automations/google/callback",
        params={"state": query["state"][0], "code": "one-time-code"},
        headers={"Host": "localhost"},
    )

    assert done.status_code == 200
    assert seen["client_id"] == [BUILTIN_GOOGLE[0]]
    assert seen["client_secret"] == [BUILTIN_GOOGLE[1]]
    assert _challenge(seen["code_verifier"][0]) == query["code_challenge"][0]
    tokens = load_google_tokens()
    assert tokens is not None
    assert tokens.client_id == BUILTIN_GOOGLE[0]


def test_google_flow_finishes_with_the_app_it_started_with(
    client: TestClient, vault_manager, tmp_path, monkeypatch, builtin_google
) -> None:
    google_tests._init(vault_manager)
    google_tests._patch_state_files(tmp_path, monkeypatch)
    started = client.post("/api/automations/google/connect", headers={"Host": "localhost"})
    state = _query(started.json()["authorization_url"])["state"][0]
    # The user saves their own app while the consent screen is open.
    google_tests._connect_config(client)

    seen: dict[str, list[str]] = {}
    google_tests._mock_google_http(monkeypatch, _google_token_handler(seen))
    client.get(
        "/api/automations/google/callback",
        params={"state": state, "code": "one-time-code"},
        headers={"Host": "localhost"},
    )

    assert seen["client_id"] == [BUILTIN_GOOGLE[0]]


def test_google_without_any_app_still_asks_for_credentials(
    client: TestClient, vault_manager
) -> None:
    google_tests._init(vault_manager)
    assert client.get("/api/automations/google").json()["builtin_app"] is False
    response = client.post("/api/automations/google/connect", headers={"Host": "localhost"})
    assert response.status_code == 409


# ---------------------------------------------------------------------------
# Outlook: Loom's app is a public client (PKCE, no secret)
# ---------------------------------------------------------------------------


def test_outlook_one_click_connect_is_a_public_pkce_client(
    client: TestClient, vault_manager, tmp_path, monkeypatch, builtin_microsoft
) -> None:
    outlook_tests._init(vault_manager)
    outlook_tests._patch_state_files(tmp_path, monkeypatch)
    assert client.get("/api/automations/calendar/outlook").json()["builtin_app"] is True

    started = client.post(
        "/api/automations/calendar/outlook/connect", headers={"Host": "localhost"}
    )
    assert started.status_code == 200
    query = _query(started.json()["authorization_url"])
    assert query["client_id"] == [BUILTIN_MICROSOFT]

    seen: dict[str, list[str]] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "login.microsoftonline.com":
            seen.update(parse_qs(request.content.decode()))
            return httpx.Response(
                200,
                json={"access_token": "m.a", "refresh_token": "m.r", "expires_in": 3600},
            )
        return httpx.Response(200, json={"mail": "ada@outlook.com"})

    outlook_tests._mock_outlook_http(monkeypatch, handler)
    done = client.get(
        "/api/automations/calendar/outlook/callback",
        params={"state": query["state"][0], "code": "one-time-code"},
        headers={"Host": "localhost"},
    )

    assert done.status_code == 200
    assert seen["client_id"] == [BUILTIN_MICROSOFT]
    assert "client_secret" not in seen
    assert _challenge(seen["code_verifier"][0]) == query["code_challenge"][0]
    tokens = load_outlook_tokens()
    assert tokens is not None
    assert tokens.client_id == BUILTIN_MICROSOFT
