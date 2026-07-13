"""OpenRouter PKCE account-linking route tests."""

from __future__ import annotations

import json
import time
from typing import TYPE_CHECKING, Any
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
import yaml
from starlette.requests import Request
from starlette.responses import Response

import api.routers.provider_auth as provider_auth
from api.main import redact_provider_oauth_query
from core.config import AgentModelOverride, GlobalConfig, ProviderConfig, settings
from core.secrets import decrypt, is_encrypted, reset_cipher_cache

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator
    from pathlib import Path

    from starlette.testclient import TestClient

_LOOPBACK_HEADERS = {"Host": "localhost"}


@pytest.fixture(autouse=True)
def _clear_oauth_flows() -> Iterator[None]:
    with provider_auth._FLOWS_LOCK:
        provider_auth._FLOWS.clear()
    yield
    with provider_auth._FLOWS_LOCK:
        provider_auth._FLOWS.clear()


@pytest.fixture()
def oauth_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """Point both config persistence and secret encryption at a temp Loom home."""
    loom_home = tmp_path / ".loom"
    monkeypatch.setattr(settings, "loom_home", loom_home)
    reset_cipher_cache()
    cfg_path = loom_home / "config.yaml"
    yield cfg_path
    reset_cipher_cache()


def _start(client: TestClient) -> tuple[str, str, dict[str, list[str]]]:
    response = client.post(
        "/api/providers/openrouter/oauth/start",
        headers=_LOOPBACK_HEADERS,
    )
    assert response.status_code == 200
    authorization_url = response.json()["authorization_url"]
    auth_query = parse_qs(urlparse(authorization_url).query)
    callback_url = auth_query["callback_url"][0]
    callback_query = parse_qs(urlparse(callback_url).query)
    return authorization_url, callback_query["state"][0], auth_query


def _mock_openrouter(
    monkeypatch: pytest.MonkeyPatch,
    handler: Callable[[httpx.Request], httpx.Response],
) -> None:
    real_async_client = httpx.AsyncClient

    def fake_async_client(**kwargs: Any) -> httpx.AsyncClient:
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_async_client(**kwargs)

    monkeypatch.setattr(provider_auth.httpx, "AsyncClient", fake_async_client)


def test_start_returns_s256_flow_without_verifier(client: TestClient) -> None:
    authorization_url, state, auth_query = _start(client)

    parsed = urlparse(authorization_url)
    assert parsed.scheme == "https"
    assert parsed.netloc == "openrouter.ai"
    assert parsed.path == "/auth"
    assert auth_query["code_challenge_method"] == ["S256"]

    callback = urlparse(auth_query["callback_url"][0])
    assert callback.scheme == "http"
    assert callback.hostname == "localhost"
    assert callback.path == "/api/providers/openrouter/oauth/callback"

    with provider_auth._FLOWS_LOCK:
        flow = provider_auth._FLOWS[state]
    assert auth_query["code_challenge"] == [provider_auth._pkce_challenge(flow.verifier)]
    assert flow.verifier not in authorization_url


def test_start_rejects_non_loopback_callback_origin(client: TestClient) -> None:
    # ``testserver`` is admitted by TrustedHostMiddleware for the test suite,
    # but it is intentionally not a valid account-linking origin.
    response = client.post("/api/providers/openrouter/oauth/start")
    assert response.status_code == 400
    assert "loopback" in response.json()["detail"]


def test_start_is_rate_limited(client: TestClient) -> None:
    for _ in range(5):
        response = client.post(
            "/api/providers/openrouter/oauth/start",
            headers=_LOOPBACK_HEADERS,
        )
        assert response.status_code == 200

    blocked = client.post(
        "/api/providers/openrouter/oauth/start",
        headers=_LOOPBACK_HEADERS,
    )
    assert blocked.status_code == 429


def test_token_gate_keeps_start_protected_but_allows_callback(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "api_token", "required-token")

    start = client.post(
        "/api/providers/openrouter/oauth/start",
        headers=_LOOPBACK_HEADERS,
    )
    assert start.status_code == 401

    # OpenRouter cannot attach Loom's optional token header when it redirects
    # the user's browser. The one-time state remains mandatory at the route.
    callback = client.get(
        "/api/providers/openrouter/oauth/callback",
        headers=_LOOPBACK_HEADERS,
    )
    assert callback.status_code == 400
    assert callback.status_code != 401


@pytest.mark.asyncio
async def test_callback_query_is_redacted_before_access_logging() -> None:
    scope: dict[str, Any] = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/api/providers/openrouter/oauth/callback",
        "raw_path": b"/api/providers/openrouter/oauth/callback",
        "query_string": b"state=flow-state&code=one-time-secret",
        "root_path": "",
        "headers": [(b"host", b"localhost")],
        "client": ("127.0.0.1", 1234),
        "server": ("localhost", 8000),
    }
    request = Request(scope)

    async def call_next(received: Request) -> Response:
        assert received.query_params["code"] == "one-time-secret"
        return Response("ok")

    response = await redact_provider_oauth_query(request, call_next)
    assert response.status_code == 200
    assert scope["query_string"] == b""


@pytest.mark.parametrize(
    ("params", "expected_text"),
    [
        ({}, "connection failed"),
        ({"state": "not-a-real-flow", "code": "auth-code"}, "connection failed"),
        ({"state": "s" * 257, "code": "c" * 4097}, "connection failed"),
    ],
)
def test_callback_rejects_missing_or_unknown_state_without_exchange(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    params: dict[str, str],
    expected_text: str,
) -> None:
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"key": "must-not-be-used"})

    _mock_openrouter(monkeypatch, handler)
    response = client.get(
        "/api/providers/openrouter/oauth/callback",
        params=params,
        headers=_LOOPBACK_HEADERS,
    )
    assert response.status_code == 400
    assert response.headers["content-type"].startswith("text/html")
    assert expected_text in response.text.lower()
    if submitted_code := params.get("code"):
        assert submitted_code not in response.text
    assert calls == 0


def test_callback_rejects_expired_state_without_exchange(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, state, _ = _start(client)
    with provider_auth._FLOWS_LOCK:
        prior = provider_auth._FLOWS[state]
        provider_auth._FLOWS[state] = provider_auth._OAuthFlow(
            verifier=prior.verifier,
            expires_at=time.monotonic() - 1,
        )

    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"key": "must-not-be-used"})

    _mock_openrouter(monkeypatch, handler)
    response = client.get(
        "/api/providers/openrouter/oauth/callback",
        params={"state": state, "code": "expired-code"},
        headers=_LOOPBACK_HEADERS,
    )
    assert response.status_code == 400
    assert calls == 0


def test_success_encrypts_key_preserves_config_and_blocks_replay(
    client: TestClient,
    oauth_config: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cfg = GlobalConfig(
        active_vault="work",
        default_provider="openai",
        chat_provider="openai",
        embed_provider="openai",
        providers={
            "openai": ProviderConfig(
                api_key="sk-existing",
                chat_model="gpt-4.1-mini",
                embed_model="text-embedding-3-small",
            ),
            "openrouter": ProviderConfig(
                api_key="or-old",
                chat_model="custom/model",
                base_url="https://example.invalid/openrouter",
            ),
        },
        agent_models={"weaver": AgentModelOverride(provider="openai", chat_model="gpt-4.1-mini")},
    )
    cfg.save(oauth_config)

    _, state, _ = _start(client)
    with provider_auth._FLOWS_LOCK:
        expected_verifier = provider_auth._FLOWS[state].verifier

    exchange_calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal exchange_calls
        exchange_calls += 1
        assert request.url == httpx.URL(provider_auth._OPENROUTER_EXCHANGE_URL)
        payload = json.loads(request.content)
        assert payload == {
            "code": "one-time-code",
            "code_verifier": expected_verifier,
            "code_challenge_method": "S256",
        }
        return httpx.Response(200, json={"key": "or-linked-secret"})

    _mock_openrouter(monkeypatch, handler)
    with (
        patch(
            "api.routers.provider_auth.reset_registry",
            new_callable=AsyncMock,
        ) as reset_registry,
        patch("api.runtime.reinit_providers_dependent_services") as reinit,
    ):
        response = client.get(
            "/api/providers/openrouter/oauth/callback",
            params={"state": state, "code": "one-time-code"},
            headers=_LOOPBACK_HEADERS,
        )

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["content-type"].startswith("text/html")
    assert "or-linked-secret" not in response.text
    assert "one-time-code" not in response.text
    reset_registry.assert_awaited_once()
    reinit.assert_called_once()
    assert exchange_calls == 1

    raw = yaml.safe_load(oauth_config.read_text())
    stored_key = raw["providers"]["openrouter"]["api_key"]
    assert is_encrypted(stored_key)
    assert decrypt(stored_key) == "or-linked-secret"

    saved = GlobalConfig.load(oauth_config)
    assert set(saved.providers) == {"openai", "openrouter"}
    assert saved.providers["openai"].api_key == "sk-existing"
    assert saved.providers["openrouter"].chat_model == "custom/model"
    assert saved.providers["openrouter"].base_url == "https://example.invalid/openrouter"
    assert saved.default_provider == "openai"
    assert saved.chat_provider == "openai"
    assert saved.embed_provider == "openai"
    assert saved.agent_models["weaver"].chat_model == "gpt-4.1-mini"

    replay = client.get(
        "/api/providers/openrouter/oauth/callback",
        params={"state": state, "code": "one-time-code"},
        headers=_LOOPBACK_HEADERS,
    )
    assert replay.status_code == 400
    assert exchange_calls == 1


def test_upstream_failure_consumes_flow_and_leaves_config_untouched(
    client: TestClient,
    oauth_config: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    GlobalConfig(
        default_provider="openai",
        providers={
            "openai": ProviderConfig(api_key="sk-existing", chat_model="gpt-4o-mini"),
            "openrouter": ProviderConfig(api_key="or-existing", chat_model="keep/model"),
        },
    ).save(oauth_config)
    before = oauth_config.read_bytes()
    _, state, _ = _start(client)

    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(403, json={"error": "invalid code", "secret": "do-not-leak"})

    _mock_openrouter(monkeypatch, handler)
    with patch("api.routers.provider_auth.reset_registry", new_callable=AsyncMock) as reset:
        response = client.get(
            "/api/providers/openrouter/oauth/callback",
            params={"state": state, "code": "rejected-code"},
            headers=_LOOPBACK_HEADERS,
        )

    assert response.status_code == 502
    assert "invalid code" not in response.text
    assert "do-not-leak" not in response.text
    assert "rejected-code" not in response.text
    assert oauth_config.read_bytes() == before
    assert calls == 1
    reset.assert_not_awaited()

    replay = client.get(
        "/api/providers/openrouter/oauth/callback",
        params={"state": state, "code": "rejected-code"},
        headers=_LOOPBACK_HEADERS,
    )
    assert replay.status_code == 400
    assert calls == 1
