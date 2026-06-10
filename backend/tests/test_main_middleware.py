"""Tests for the hardening middleware wired in :mod:`api.main`.

Covers TrustedHostMiddleware (DNS-rebinding defense) and the security-header
middleware. These exercise the ASGI stack directly rather than going through a
vault-backed route, so no fixtures are needed.
"""

from starlette.testclient import TestClient

from api.main import app


def test_disallowed_host_returns_400() -> None:
    """A request with an unlisted Host header is rejected by the middleware."""
    client = TestClient(app)
    resp = client.get("/api/health", headers={"Host": "evil.example.com"})
    assert resp.status_code == 400


def test_testserver_host_is_allowed() -> None:
    """The default TestClient Host (``testserver``) passes the check.

    This guards the regression where dropping ``testserver`` from the allowed
    hosts would 400 the entire test suite.
    """
    client = TestClient(app)
    resp = client.get("/api/health")
    assert resp.status_code == 200


def test_localhost_host_is_allowed() -> None:
    """An explicit ``localhost`` Host header is accepted."""
    client = TestClient(app)
    resp = client.get("/api/health", headers={"Host": "localhost"})
    assert resp.status_code == 200


def test_security_headers_present_on_normal_response() -> None:
    """Hardening headers are attached to a normal (200) response."""
    client = TestClient(app)
    resp = client.get("/api/health")
    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert resp.headers["X-Frame-Options"] == "DENY"
    assert resp.headers["Referrer-Policy"] == "no-referrer"
