"""'Sign in with GitHub' for the GitHub Bridge, via the OAuth device flow.

``POST /device/start`` asks GitHub for a user code; the UI shows it and opens
github.com/login/device. ``POST /device/poll`` is then called on GitHub's
interval until the user approves. The device code stays in this process; the
browser only ever holds an opaque ``flow_id``. On approval the token is saved
like a pasted personal access token (Fernet-encrypted in ``config.yaml``).
"""

from __future__ import annotations

import asyncio
import secrets
import threading
import time
from dataclasses import dataclass
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from bridge.github_auth import GitHubDeviceAuth, GitHubSignInError
from bridge.github_service import get_github_sync_service
from bridge.oauth_apps import github_device_client_id
from core.config import GlobalConfig
from core.rate_limit import WRITE_LIMIT, limiter
from core.vault import VaultManager, get_vault_manager

router = APIRouter(prefix="/api/automations/github/device", tags=["github-bridge"])

_MAX_FLOWS = 20


@dataclass(slots=True)
class _DeviceFlow:
    device_code: str
    expires_at: float  # time.monotonic()
    interval: float
    next_poll_at: float


_FLOWS: dict[str, _DeviceFlow] = {}
_FLOWS_LOCK = threading.Lock()
# One GitHub token request at a time: a second concurrent poll for the same
# code would race the first and could be told the code is already used.
_POLL_LOCK = asyncio.Lock()


def reset_device_flows() -> None:
    """Forget every in-flight sign-in (test teardown)."""
    with _FLOWS_LOCK:
        _FLOWS.clear()


class DeviceStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    include_private: bool = False


class DeviceStartResponse(BaseModel):
    flow_id: str
    user_code: str
    verification_uri: str
    expires_in: int
    interval: int


class DevicePollRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    flow_id: str = Field(min_length=1, max_length=100)


class DevicePollResponse(BaseModel):
    status: Literal["pending", "connected", "expired", "denied"]
    interval: int = 0
    account: str = ""


def _client_id() -> str:
    client_id = github_device_client_id()
    if not client_id:
        raise HTTPException(
            status_code=409,
            detail="Sign in with GitHub is not set up for this Loom; paste a token instead",
        )
    return client_id


@router.post("/start", response_model=DeviceStartResponse)
@limiter.limit(WRITE_LIMIT)
async def start_github_sign_in(
    request: Request,  # noqa: ARG001 — required by slowapi
    body: DeviceStartRequest,
) -> DeviceStartResponse:
    """Begin a device sign-in and return the code to show the user."""
    auth = GitHubDeviceAuth(_client_id())
    try:
        code = await auth.start(include_private=body.include_private)
    except GitHubSignInError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        await auth.aclose()
    now = time.monotonic()
    flow_id = secrets.token_urlsafe(24)
    with _FLOWS_LOCK:
        for key in [k for k, flow in _FLOWS.items() if flow.expires_at <= now]:
            _FLOWS.pop(key, None)
        while len(_FLOWS) >= _MAX_FLOWS:
            _FLOWS.pop(next(iter(_FLOWS)))
        _FLOWS[flow_id] = _DeviceFlow(
            device_code=code.device_code,
            expires_at=now + code.expires_in,
            interval=code.interval,
            next_poll_at=now + code.interval,
        )
    return DeviceStartResponse(
        flow_id=flow_id,
        user_code=code.user_code,
        verification_uri=code.verification_uri,
        expires_in=code.expires_in,
        interval=code.interval,
    )


@router.post("/poll", response_model=DevicePollResponse)
@limiter.limit(WRITE_LIMIT)
async def poll_github_sign_in(
    request: Request,  # noqa: ARG001 — required by slowapi
    body: DevicePollRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> DevicePollResponse:
    """Check once whether the user approved the code; save the token when so."""
    client_id = _client_id()
    async with _POLL_LOCK:
        now = time.monotonic()
        with _FLOWS_LOCK:
            flow = _FLOWS.get(body.flow_id)
            if flow is not None and flow.expires_at <= now:
                _FLOWS.pop(body.flow_id, None)
                flow = None
        if flow is None:
            return DevicePollResponse(status="expired")
        if now < flow.next_poll_at:
            # Polling faster than GitHub allows earns a slow_down; answer locally.
            return DevicePollResponse(status="pending", interval=int(flow.interval))

        auth = GitHubDeviceAuth(client_id)
        account = ""
        try:
            result = await auth.poll(flow.device_code)
            if result.status == "connected":
                account = await auth.fetch_login(result.access_token)
        except GitHubSignInError as exc:
            with _FLOWS_LOCK:
                _FLOWS.pop(body.flow_id, None)
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        finally:
            await auth.aclose()

        if result.status == "pending" or result.status == "slow_down":
            if result.status == "slow_down":
                flow.interval = max(float(result.interval), flow.interval + 5)
            flow.next_poll_at = time.monotonic() + flow.interval
            return DevicePollResponse(status="pending", interval=int(flow.interval))

        with _FLOWS_LOCK:
            _FLOWS.pop(body.flow_id, None)
        if result.status == "expired" or result.status == "denied":
            return DevicePollResponse(status=result.status)

        config = GlobalConfig.load(vm.config_path())
        config.github.token = result.access_token
        config.github.account = account
        config.save(vm.config_path())
        get_github_sync_service().notify()
        return DevicePollResponse(status="connected", account=account)
