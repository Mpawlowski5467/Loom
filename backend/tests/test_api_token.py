"""Tests for the optional shared-token API gate wired in :mod:`api.main`.

The ``api_token_gate`` middleware is inert unless ``LOOM_API_TOKEN`` is set.
These exercise the ASGI stack directly (no vault fixtures): an *unknown* ``/api``
path is used as a probe so the gate's pass/block behaviour is observable
independent of any route's own logic — a 404 means the request passed the gate
and reached routing, a 401 means the gate blocked it first.
"""

import pytest
from starlette.testclient import TestClient

from api.main import app
from core.config import settings

# Unknown path: routing answers 404, so any 401 here is the gate, not the route.
PROBE_PATH = "/api/__gate_probe__"
TOKEN = "s3cret-shared-token"


@pytest.fixture()
def no_token(monkeypatch: pytest.MonkeyPatch) -> None:
    """Force the default (gate disabled) posture regardless of the dev env."""
    monkeypatch.setattr(settings, "api_token", "")


@pytest.fixture()
def with_token(monkeypatch: pytest.MonkeyPatch) -> str:
    """Configure a shared token and return it."""
    monkeypatch.setattr(settings, "api_token", TOKEN)
    return TOKEN


def test_no_token_configured_api_is_open(no_token: None) -> None:
    """Default posture: no token configured → the gate never challenges."""
    client = TestClient(app)
    # Unknown /api path falls through the gate to a normal 404, not a 401.
    assert client.get(PROBE_PATH).status_code == 404
    # A real endpoint answers with no credential at all.
    assert client.get("/api/traces").status_code == 200


def test_missing_token_is_rejected(with_token: str) -> None:
    """Token configured but no credential presented → 401 in the error shape."""
    client = TestClient(app)
    resp = client.get(PROBE_PATH)
    assert resp.status_code == 401
    assert resp.json() == {"error": "Missing or invalid API token", "type": "Unauthorized"}
    assert resp.headers["WWW-Authenticate"] == "Bearer"


def test_wrong_token_is_rejected(with_token: str) -> None:
    """A mismatching token is rejected via either accepted header."""
    client = TestClient(app)
    assert client.get(PROBE_PATH, headers={"Authorization": "Bearer nope"}).status_code == 401
    assert client.get(PROBE_PATH, headers={"X-Loom-Token": "nope"}).status_code == 401


def test_mutating_request_is_gated(with_token: str) -> None:
    """Mutating requests are gated too — a POST with no token is blocked first."""
    client = TestClient(app)
    assert client.post(PROBE_PATH, json={}).status_code == 401


def test_bearer_header_is_accepted(with_token: str) -> None:
    """A correct Authorization: Bearer token reaches the route (200)."""
    client = TestClient(app)
    resp = client.get("/api/traces", headers={"Authorization": f"Bearer {with_token}"})
    assert resp.status_code == 200


def test_x_loom_token_header_is_accepted(with_token: str) -> None:
    """A correct X-Loom-Token shorthand reaches the route (200)."""
    client = TestClient(app)
    resp = client.get("/api/traces", headers={"X-Loom-Token": with_token})
    assert resp.status_code == 200


def test_valid_token_passes_gate_to_routing(with_token: str) -> None:
    """A correct token lets even an unknown path through to a real 404."""
    client = TestClient(app)
    resp = client.get(PROBE_PATH, headers={"Authorization": f"Bearer {with_token}"})
    assert resp.status_code == 404


def test_cors_preflight_options_passes_gate_without_token(
    with_token: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A cross-origin preflight never carries the token, so the gate must let
    CORSMiddleware answer it — otherwise the dev SPA (Vite on :5173) breaks
    entirely when a token is configured."""
    monkeypatch.setattr(settings, "cors_origins", ["http://localhost:5173"])
    client = TestClient(app)
    resp = client.options(
        PROBE_PATH,
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert resp.status_code == 200
    assert resp.headers["access-control-allow-origin"] == "http://localhost:5173"

    # The follow-up real request is still challenged without the token.
    assert client.get(PROBE_PATH, headers={"Origin": "http://localhost:5173"}).status_code == 401


def test_non_preflight_options_also_passes_gate(with_token: str) -> None:
    """A plain OPTIONS (no CORS headers) is unchallenged too — it reaches
    routing (404 here) instead of being blocked as a 401 by the gate."""
    client = TestClient(app)
    assert client.options(PROBE_PATH).status_code == 404


def test_health_stays_open_with_token_configured(with_token: str) -> None:
    """The liveness probe is exempt so the Docker smoke test keeps passing."""
    client = TestClient(app)
    assert client.get("/api/health").status_code == 200


def test_ready_stays_open_with_token_configured(with_token: str) -> None:
    """Readiness is exempt — it may be 200 or 503, but never 401."""
    client = TestClient(app)
    assert client.get("/api/ready").status_code != 401


def test_health_stays_open_without_token_configured(no_token: None) -> None:
    """Health is open in the default posture too (regression guard)."""
    client = TestClient(app)
    assert client.get("/api/health").status_code == 200
