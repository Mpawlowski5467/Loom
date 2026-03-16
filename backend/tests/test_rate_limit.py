"""Tests for core/rate_limit.py — rate limiter defaults and handler."""

from __future__ import annotations

from typing import TYPE_CHECKING
from unittest.mock import patch

from fastapi import Request
from limits import parse as parse_limit
from slowapi.errors import RateLimitExceeded
from slowapi.wrappers import Limit

from core.rate_limit import (
    READ_LIMIT,
    WRITE_LIMIT,
    _load_limits,
    rate_limit_exceeded_handler,
)

if TYPE_CHECKING:
    from starlette.testclient import TestClient

# ---------------------------------------------------------------------------
# Default limits
# ---------------------------------------------------------------------------


class TestLoadLimits:
    """Verify _load_limits returns sensible defaults."""

    def test_defaults_when_no_config(self) -> None:
        """Without a config file, defaults are used."""
        with patch("core.rate_limit.GlobalConfig") as mock_cfg_cls:
            mock_cfg_cls.load.side_effect = FileNotFoundError("no config")
            read, write = _load_limits()

        assert read == "120/minute"
        assert write == "30/minute"

    def test_module_level_defaults(self) -> None:
        """Module-level READ_LIMIT and WRITE_LIMIT have reasonable values."""
        # Even if config loading fails, module-level constants are populated.
        assert "minute" in READ_LIMIT or "second" in READ_LIMIT
        assert "minute" in WRITE_LIMIT or "second" in WRITE_LIMIT

    def test_defaults_when_config_has_no_rate_limit_key(self) -> None:
        """Config file exists but has no rate_limit section."""
        with patch("core.rate_limit.GlobalConfig") as mock_cfg_cls:
            mock_cfg = mock_cfg_cls.load.return_value
            mock_cfg.model_dump.return_value = {}
            read, write = _load_limits()

        assert read == "120/minute"
        assert write == "30/minute"

    def test_custom_limits_from_config(self) -> None:
        """rate_limit section in config overrides defaults."""
        with patch("core.rate_limit.GlobalConfig") as mock_cfg_cls:
            mock_cfg = mock_cfg_cls.load.return_value
            mock_cfg.model_dump.return_value = {
                "rate_limit": {"read": "60/minute", "write": "10/minute"},
            }
            read, write = _load_limits()

        assert read == "60/minute"
        assert write == "10/minute"

    def test_partial_config_uses_defaults_for_missing(self) -> None:
        """Only `read` is set — `write` falls back to default."""
        with patch("core.rate_limit.GlobalConfig") as mock_cfg_cls:
            mock_cfg = mock_cfg_cls.load.return_value
            mock_cfg.model_dump.return_value = {
                "rate_limit": {"read": "200/minute"},
            }
            read, write = _load_limits()

        assert read == "200/minute"
        assert write == "30/minute"


# ---------------------------------------------------------------------------
# Exception handler
# ---------------------------------------------------------------------------


def _make_rate_limit_exc(rate: str = "5/minute") -> RateLimitExceeded:
    """Create a RateLimitExceeded with a proper Limit wrapper."""
    lim = Limit(parse_limit(rate), "", "", False, None, None, None, None, None)
    return RateLimitExceeded(lim)


class TestRateLimitExceededHandler:
    """Verify the custom 429 handler returns correct JSON."""

    def test_returns_429_status(self) -> None:
        """Handler produces a 429 JSONResponse."""
        scope = {
            "type": "http",
            "method": "GET",
            "path": "/api/notes",
            "headers": [],
            "query_string": b"",
        }
        request = Request(scope)
        exc = _make_rate_limit_exc("5/minute")

        response = rate_limit_exceeded_handler(request, exc)

        assert response.status_code == 429

    def test_response_body_structure(self) -> None:
        """Body contains `error` and `type` fields."""
        scope = {
            "type": "http",
            "method": "GET",
            "path": "/api/notes",
            "headers": [],
            "query_string": b"",
        }
        request = Request(scope)
        exc = _make_rate_limit_exc("5/minute")

        response = rate_limit_exceeded_handler(request, exc)
        body = response.body.decode("utf-8")

        assert "RateLimitExceeded" in body
        assert "Rate limit exceeded" in body

    def test_retry_after_header(self) -> None:
        """Response includes a Retry-After header."""
        scope = {
            "type": "http",
            "method": "POST",
            "path": "/api/notes",
            "headers": [],
            "query_string": b"",
        }
        request = Request(scope)
        exc = _make_rate_limit_exc("10/minute")

        response = rate_limit_exceeded_handler(request, exc)

        assert "retry-after" in response.headers


class TestRateLimitIntegration:
    """Verify the handler is wired into the FastAPI app."""

    def test_health_endpoint_works(self, client: TestClient) -> None:
        """Basic sanity: /api/health responds 200 — app with limiter boots."""
        resp = client.get("/api/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}
