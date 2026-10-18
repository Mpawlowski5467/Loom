"""'Sign in with GitHub' (OAuth device flow) for the GitHub Bridge."""

from typing import Any
from urllib.parse import parse_qs

import httpx
import pytest
from starlette.testclient import TestClient

from api.routers import github_sign_in
from core.config import GlobalConfig, settings

CLIENT_ID = "Iv1.loom-builtin"


@pytest.fixture(autouse=True)
def _reset_flows():
    github_sign_in.reset_device_flows()
    yield
    github_sign_in.reset_device_flows()


@pytest.fixture()
def github_app(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "github_client_id", CLIENT_ID)


class _FakeGitHub:
    """Scripted GitHub: queued token-endpoint replies, recorded requests."""

    def __init__(self, *token_replies: dict[str, Any]) -> None:
        self.token_replies = list(token_replies)
        self.requests: list[tuple[str, dict[str, list[str]]]] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        form = parse_qs(request.content.decode())
        self.requests.append((request.url.path, form))
        if request.url.path == "/login/device/code":
            return httpx.Response(
                200,
                json={
                    "device_code": "secret-device-code",
                    "user_code": "WDJB-MJHT",
                    "verification_uri": "https://github.com/login/device",
                    "expires_in": 900,
                    "interval": 5,
                },
            )
        if request.url.path == "/login/oauth/access_token":
            return httpx.Response(200, json=self.token_replies.pop(0))
        assert request.url.path == "/user"
        return httpx.Response(200, json={"login": "ada-dev"})

    def token_calls(self) -> int:
        return sum(1 for path, _ in self.requests if path == "/login/oauth/access_token")


def _mock_github(monkeypatch: pytest.MonkeyPatch, fake: _FakeGitHub) -> None:
    real = httpx.AsyncClient

    def fake_client(**kwargs: Any) -> httpx.AsyncClient:
        kwargs["transport"] = httpx.MockTransport(fake.handler)
        return real(**kwargs)

    monkeypatch.setattr("bridge.github_auth.httpx.AsyncClient", fake_client)


def _start(client: TestClient, **body: Any) -> dict[str, Any]:
    response = client.post("/api/automations/github/device/start", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def _poll(client: TestClient, flow_id: str, *, now: bool = True) -> dict[str, Any]:
    if now:  # skip GitHub's minimum interval instead of sleeping
        github_sign_in._FLOWS[flow_id].next_poll_at = 0
    response = client.post("/api/automations/github/device/poll", json={"flow_id": flow_id})
    assert response.status_code == 200, response.text
    return response.json()


def test_not_offered_without_a_builtin_app(client: TestClient) -> None:
    assert client.get("/api/automations/github").json()["builtin_app"] is False
    response = client.post("/api/automations/github/device/start", json={})
    assert response.status_code == 409


def test_start_returns_a_user_code_but_keeps_the_device_code(
    client: TestClient, monkeypatch, github_app
) -> None:
    fake = _FakeGitHub()
    _mock_github(monkeypatch, fake)
    assert client.get("/api/automations/github").json()["builtin_app"] is True

    started = _start(client)

    assert started["user_code"] == "WDJB-MJHT"
    assert started["verification_uri"] == "https://github.com/login/device"
    assert "secret-device-code" not in str(started)
    # Public repositories need no scope; nothing broader is requested.
    assert "scope" not in fake.requests[0][1]


def test_private_repos_request_the_repo_scope(client: TestClient, monkeypatch, github_app) -> None:
    fake = _FakeGitHub()
    _mock_github(monkeypatch, fake)
    _start(client, include_private=True)
    assert fake.requests[0][1]["scope"] == ["repo"]


def test_approval_saves_the_token_and_account(
    client: TestClient, vault_manager, monkeypatch, github_app
) -> None:
    fake = _FakeGitHub(
        {"error": "authorization_pending"},
        {"access_token": "gho_signed_in", "token_type": "bearer", "scope": ""},
    )
    _mock_github(monkeypatch, fake)
    flow_id = _start(client)["flow_id"]

    assert _poll(client, flow_id)["status"] == "pending"
    connected = _poll(client, flow_id)

    assert connected == {"status": "connected", "interval": 0, "account": "ada-dev"}
    config = GlobalConfig.load(vault_manager.config_path())
    assert config.github.token == "gho_signed_in"
    assert config.github.account == "ada-dev"
    assert "gho_signed_in" not in vault_manager.config_path().read_text()
    public = client.get("/api/automations/github").json()["github"]
    assert (public["token_set"], public["account"]) == (True, "ada-dev")
    # The flow is spent: polling it again cannot mint another token.
    assert _poll(client, flow_id, now=False)["status"] == "expired"


def test_polling_too_early_does_not_call_github(
    client: TestClient, monkeypatch, github_app
) -> None:
    fake = _FakeGitHub()
    _mock_github(monkeypatch, fake)
    flow_id = _start(client)["flow_id"]

    assert _poll(client, flow_id, now=False) == {"status": "pending", "interval": 5, "account": ""}
    assert fake.token_calls() == 0


def test_slow_down_backs_off(client: TestClient, monkeypatch, github_app) -> None:
    fake = _FakeGitHub({"error": "slow_down", "interval": 10})
    _mock_github(monkeypatch, fake)
    flow_id = _start(client)["flow_id"]

    assert _poll(client, flow_id)["interval"] == 10


@pytest.mark.parametrize(
    ("reply", "status"),
    [({"error": "access_denied"}, "denied"), ({"error": "expired_token"}, "expired")],
)
def test_denied_or_expired_ends_the_flow(
    client: TestClient, monkeypatch, github_app, reply: dict[str, str], status: str
) -> None:
    fake = _FakeGitHub(reply)
    _mock_github(monkeypatch, fake)
    flow_id = _start(client)["flow_id"]

    assert _poll(client, flow_id)["status"] == status
    assert flow_id not in github_sign_in._FLOWS


def test_disabled_device_flow_is_a_clear_error(client: TestClient, monkeypatch, github_app) -> None:
    fake = _FakeGitHub({"error": "device_flow_disabled"})
    _mock_github(monkeypatch, fake)
    flow_id = _start(client)["flow_id"]
    github_sign_in._FLOWS[flow_id].next_poll_at = 0

    response = client.post("/api/automations/github/device/poll", json={"flow_id": flow_id})

    assert response.status_code == 502
    assert "disabled" in response.json()["detail"]


def test_unknown_flow_reads_as_expired(client: TestClient, github_app) -> None:
    response = client.post("/api/automations/github/device/poll", json={"flow_id": "nope"})
    assert response.json()["status"] == "expired"


def test_pasting_a_token_clears_the_signed_in_account(
    client: TestClient, vault_manager, monkeypatch, github_app
) -> None:
    fake = _FakeGitHub({"access_token": "gho_signed_in"})
    _mock_github(monkeypatch, fake)
    _poll(client, _start(client)["flow_id"])

    client.patch("/api/automations/github", json={"token": "github_pat_manual"})

    config = GlobalConfig.load(vault_manager.config_path())
    assert (config.github.token, config.github.account) == ("github_pat_manual", "")
