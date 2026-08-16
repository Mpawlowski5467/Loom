"""Short-lived GitHub device authorization state."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Literal, TypedDict

import httpx

_DEVICE_CODE_URL = "https://github.com/login/device/code"
_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token"
_ACCEPT = "application/json"


class GitHubDeviceFlowError(RuntimeError):
    """Raised when GitHub rejects or cannot start device authorization."""


class DeviceStart(TypedDict):
    verification_uri: str
    user_code: str
    expires_in: int
    interval: int


class DevicePoll(TypedDict):
    status: Literal["idle", "pending", "connected", "error"]
    access_token: str
    error: str


@dataclass
class _PendingFlow:
    device_code: str
    user_code: str
    verification_uri: str
    expires_at: float
    interval: int
    next_poll_at: float = 0


_flow: _PendingFlow | None = None
_lock = asyncio.Lock()


async def start_device_flow(client_id: str) -> DeviceStart:
    """Start (or replace) the single local GitHub device flow."""
    global _flow
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                _DEVICE_CODE_URL,
                data={"client_id": client_id},
                headers={"Accept": _ACCEPT},
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise GitHubDeviceFlowError("GitHub authorization could not be started") from exc

    required = ("device_code", "user_code", "verification_uri", "expires_in")
    if any(not payload.get(key) for key in required):
        detail = str(payload.get("error_description") or payload.get("error") or "")
        raise GitHubDeviceFlowError(detail or "GitHub returned an invalid authorization response")

    interval = max(5, int(payload.get("interval") or 5))
    expires_in = max(1, int(payload["expires_in"]))
    async with _lock:
        _flow = _PendingFlow(
            device_code=str(payload["device_code"]),
            user_code=str(payload["user_code"]),
            verification_uri=str(payload["verification_uri"]),
            expires_at=time.monotonic() + expires_in,
            interval=interval,
        )
    return {
        "verification_uri": str(payload["verification_uri"]),
        "user_code": str(payload["user_code"]),
        "expires_in": expires_in,
        "interval": interval,
    }


async def poll_device_flow(client_id: str) -> DevicePoll:
    """Poll GitHub once, respecting its requested polling interval."""
    global _flow
    async with _lock:
        flow = _flow
        if flow is None:
            return {"status": "idle", "access_token": "", "error": ""}
        now = time.monotonic()
        if now >= flow.expires_at:
            _flow = None
            return {
                "status": "error",
                "access_token": "",
                "error": "GitHub authorization expired. Start it again.",
            }
        if now < flow.next_poll_at:
            return {"status": "pending", "access_token": "", "error": ""}
        flow.next_poll_at = now + flow.interval

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                _ACCESS_TOKEN_URL,
                data={
                    "client_id": client_id,
                    "device_code": flow.device_code,
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                },
                headers={"Accept": _ACCEPT},
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError):
        return {
            "status": "error",
            "access_token": "",
            "error": "GitHub authorization could not be checked",
        }

    token = str(payload.get("access_token") or "")
    if token:
        async with _lock:
            if _flow is flow:
                _flow = None
        return {"status": "connected", "access_token": token, "error": ""}

    error = str(payload.get("error") or "")
    if error == "authorization_pending":
        return {"status": "pending", "access_token": "", "error": ""}
    if error == "slow_down":
        async with _lock:
            if _flow is flow:
                flow.interval += 5
                flow.next_poll_at = time.monotonic() + flow.interval
        return {"status": "pending", "access_token": "", "error": ""}

    async with _lock:
        if _flow is flow:
            _flow = None
    detail = str(payload.get("error_description") or "").strip()
    return {
        "status": "error",
        "access_token": "",
        "error": detail or "GitHub authorization was denied or expired",
    }


async def clear_device_flow() -> None:
    global _flow
    async with _lock:
        _flow = None
