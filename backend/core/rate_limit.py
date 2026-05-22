"""Rate limiting middleware for FastAPI using slowapi.

Applies per-IP limits configurable via config.yaml under a ``rate_limit``
key. Defaults: 120 req/min for GET, 30 req/min for mutating methods.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.responses import JSONResponse

from core.config import GlobalConfig, settings

if TYPE_CHECKING:
    from fastapi import Request
    from slowapi.errors import RateLimitExceeded

# ---------------------------------------------------------------------------
# Load limits from config (with defaults)
# ---------------------------------------------------------------------------


def _load_limits() -> tuple[str, str]:
    """Return (read_limit, write_limit) rate strings from config.yaml."""
    default_read = "120/minute"
    default_write = "30/minute"
    try:
        cfg = GlobalConfig.load(settings.config_path)
        raw = cfg.model_dump()
        rl = raw.get("rate_limit", {}) or {}
        return (
            rl.get("read", default_read),
            rl.get("write", default_write),
        )
    except Exception:  # noqa: BLE001
        return default_read, default_write


READ_LIMIT, WRITE_LIMIT = _load_limits()

limiter = Limiter(key_func=get_remote_address)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def rate_limit_exceeded_handler(_request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """Return a 429 JSON response with rate-limit details."""
    return JSONResponse(
        status_code=429,
        content={"error": f"Rate limit exceeded: {exc.detail}", "type": "RateLimitExceeded"},
        headers={"Retry-After": str(getattr(exc, "retry_after", 60))},
    )
