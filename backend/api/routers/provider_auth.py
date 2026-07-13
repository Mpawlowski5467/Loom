"""Provider account-linking routes.

Only OpenRouter currently exposes an authorization flow that fits Loom's
existing provider model: its OAuth-style PKCE exchange returns a
user-controlled API key.  The verifier never leaves this process, flows expire
quickly, and callbacks are one-shot so a captured authorization code cannot be
replayed through Loom.
"""

from __future__ import annotations

import base64
import hashlib
import ipaddress
import secrets
import threading
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from core.config import GlobalConfig, ProviderConfig, settings
from core.providers import reset_registry
from core.rate_limit import limiter
from core.vault import VaultManager, get_vault_manager

router = APIRouter(prefix="/api/providers/openrouter/oauth", tags=["provider-auth"])

_OPENROUTER_AUTHORIZE_URL = "https://openrouter.ai/auth"
_OPENROUTER_EXCHANGE_URL = "https://openrouter.ai/api/v1/auth/keys"
_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
_DEFAULT_CHAT_MODEL = "openai/gpt-4o-mini"
_FLOW_TTL_SECONDS = 10 * 60
_START_RATE_LIMIT = "5/minute"
_MAX_EXCHANGE_RESPONSE_BYTES = 16 * 1024
_HTTP_TIMEOUT = httpx.Timeout(timeout=10.0, connect=3.0, read=7.0, write=5.0, pool=3.0)


@dataclass(frozen=True, slots=True)
class _OAuthFlow:
    verifier: str
    expires_at: float


# These stores are process-local by design. Loom is a local, single-process
# application; a restart invalidating an in-flight login is safer than putting a
# PKCE verifier on disk. The lock makes state creation and consumption atomic
# across concurrent ASGI requests and TestClient worker threads.
_FLOWS: dict[str, _OAuthFlow] = {}
_FLOWS_LOCK = threading.Lock()
_CONFIG_LOCK = threading.Lock()


class OpenRouterAuthStartResponse(BaseModel):
    authorization_url: str
    expires_in: int


def _is_loopback_host(host: str | None) -> bool:
    if not host:
        return False
    normalized = host.rstrip(".").lower()
    if normalized == "localhost" or normalized.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(normalized).is_loopback
    except ValueError:
        return False


def _callback_url(request: Request, state: str) -> str:
    """Build the registered callback from the trusted loopback request only."""
    if request.url.scheme not in {"http", "https"} or not _is_loopback_host(request.url.hostname):
        raise ValueError("Provider linking is available only from a loopback Loom URL.")
    base = str(request.url_for("openrouter_oauth_callback"))
    return f"{base}?{urlencode({'state': state})}"


def _pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _store_flow(state: str, verifier: str) -> None:
    now = time.monotonic()
    with _FLOWS_LOCK:
        expired = [key for key, flow in _FLOWS.items() if flow.expires_at <= now]
        for key in expired:
            _FLOWS.pop(key, None)
        _FLOWS[state] = _OAuthFlow(
            verifier=verifier,
            expires_at=now + _FLOW_TTL_SECONDS,
        )


def _consume_flow(state: str) -> _OAuthFlow | None:
    """Atomically remove and return a live flow; expired flows are discarded."""
    with _FLOWS_LOCK:
        flow = _FLOWS.pop(state, None)
    if flow is None or flow.expires_at <= time.monotonic():
        return None
    return flow


def _result_page(*, success: bool, error_status: int = 400) -> HTMLResponse:
    """Return a constant, non-cacheable page with no OAuth material in it."""
    if success:
        title = "OpenRouter connected"
        message = "The connection is ready. You can close this window and return to Loom."
        status_code = 200
    else:
        title = "OpenRouter connection failed"
        message = "No credentials were saved. Close this window and try again from Loom."
        status_code = error_status

    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>{title}</title>
</head>
<body>
  <main>
    <h1>{title}</h1>
    <p>{message}</p>
  </main>
</body>
</html>"""
    return HTMLResponse(
        html,
        status_code=status_code,
        headers={
            "Cache-Control": "no-store",
            "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        },
    )


async def _exchange_code(code: str, verifier: str) -> str | None:
    """Exchange an authorization code without exposing upstream response data."""
    try:
        async with httpx.AsyncClient(
            timeout=_HTTP_TIMEOUT,
            follow_redirects=False,
        ) as client:
            response = await client.post(
                _OPENROUTER_EXCHANGE_URL,
                json={
                    "code": code,
                    "code_verifier": verifier,
                    "code_challenge_method": "S256",
                },
                headers={"Accept": "application/json"},
            )
            response.raise_for_status()
            if len(response.content) > _MAX_EXCHANGE_RESPONSE_BYTES:
                return None
            payload: Any = response.json()
    except (httpx.HTTPError, ValueError):
        return None

    key = payload.get("key") if isinstance(payload, dict) else None
    if not isinstance(key, str) or not key.strip() or len(key) > 4096:
        return None
    return key.strip()


def _save_openrouter_key(key: str) -> None:
    """Merge the linked key into the latest config and atomically persist it."""
    with _CONFIG_LOCK:
        cfg = GlobalConfig.load(settings.config_path)
        prior = cfg.providers.get("openrouter")
        cfg.providers["openrouter"] = (
            prior.model_copy(update={"api_key": key})
            if prior is not None
            else ProviderConfig(
                api_key=key,
                chat_model=_DEFAULT_CHAT_MODEL,
                base_url=_OPENROUTER_BASE_URL,
            )
        )
        cfg.save(settings.config_path)


@router.post("/start", response_model=OpenRouterAuthStartResponse)
@limiter.limit(_START_RATE_LIMIT)
async def start_openrouter_oauth(request: Request) -> OpenRouterAuthStartResponse:
    """Create a short-lived OpenRouter PKCE flow for this loopback Loom URL."""
    state = secrets.token_urlsafe(32)
    # token_urlsafe(64) produces an RFC 7636-compatible verifier under the
    # 128-character ceiling while retaining substantially more than 256 bits.
    verifier = secrets.token_urlsafe(64)
    try:
        callback_url = _callback_url(request, state)
    except ValueError as exc:
        # Import locally to keep the normal success path free of another symbol
        # and to preserve FastAPI's standard JSON error shape for the SPA.
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail=str(exc)) from exc

    _store_flow(state, verifier)
    auth_query = urlencode(
        {
            "callback_url": callback_url,
            "code_challenge": _pkce_challenge(verifier),
            "code_challenge_method": "S256",
        }
    )
    authorization_url = f"{_OPENROUTER_AUTHORIZE_URL}?{auth_query}"
    return OpenRouterAuthStartResponse(
        authorization_url=authorization_url,
        expires_in=_FLOW_TTL_SECONDS,
    )


@router.get("/callback", name="openrouter_oauth_callback", response_class=HTMLResponse)
async def openrouter_oauth_callback(
    state: str | None = None,
    code: str | None = None,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> HTMLResponse:
    """Consume an OpenRouter callback, save its key, and refresh providers."""
    # Validate manually so FastAPI never echoes an oversized authorization code
    # in its normal structured validation response.
    if not state or not code or len(state) > 256 or len(code) > 4096:
        return _result_page(success=False)

    flow = _consume_flow(state)
    if flow is None:
        return _result_page(success=False)

    key = await _exchange_code(code, flow.verifier)
    if key is None:
        return _result_page(success=False, error_status=502)

    _save_openrouter_key(key)
    await reset_registry()

    # Rebind agents and the index/search services to the newly configured
    # provider. The helper is already best-effort and no-ops before a vault is
    # initialized, which keeps first-run linking safe.
    from api.runtime import reinit_providers_dependent_services

    reinit_providers_dependent_services(vm.active_vault_dir())
    return _result_page(success=True)
