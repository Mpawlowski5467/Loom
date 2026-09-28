"""GitHub sign-in with the OAuth device flow (the one ``gh auth login`` uses).

Loom asks GitHub for a short user code, the user approves it at
github.com/login/device, and Loom polls until GitHub hands over a token. No
client secret and no redirect are involved, so a single OAuth app registered
by whoever ships Loom (``LOOM_GITHUB_CLIENT_ID``) serves every install.

Scopes: none by default, which reads public repositories at the
authenticated rate limit. ``repo`` is requested only when the user opts in to
private repositories; GitHub has no read-only variant of it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

import httpx

_DEVICE_CODE_URL = "https://github.com/login/device/code"
_TOKEN_URL = "https://github.com/login/oauth/access_token"
_USER_URL = "https://api.github.com/user"
_DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"
_TIMEOUT = httpx.Timeout(connect=10.0, read=20.0, write=10.0, pool=10.0)

PRIVATE_REPO_SCOPE = "repo"

DevicePollStatus = Literal["pending", "slow_down", "connected", "expired", "denied"]


class GitHubSignInError(RuntimeError):
    """GitHub refused the device flow for a reason the user cannot fix by waiting."""


@dataclass(frozen=True, slots=True)
class DeviceCode:
    """What GitHub returns when a device sign-in starts."""

    device_code: str  # secret to this process; never sent to the browser
    user_code: str
    verification_uri: str
    expires_in: int
    interval: int


@dataclass(frozen=True, slots=True)
class DevicePoll:
    """One token-endpoint answer while the user approves the code."""

    status: DevicePollStatus
    access_token: str = ""
    interval: int = 0  # GitHub's new minimum poll interval after slow_down


# Errors that mean "stop polling" but are not the user's doing.
_FATAL_ERRORS = {
    "device_flow_disabled": "Device sign-in is disabled for Loom's GitHub app",
    "incorrect_client_credentials": "Loom's GitHub app ID is not recognized by GitHub",
    "unsupported_grant_type": "GitHub rejected the device sign-in request",
    "incorrect_device_code": "GitHub did not recognize this sign-in; start again",
}


class GitHubDeviceAuth:
    """Minimal async client for GitHub's device authorization flow."""

    def __init__(self, client_id: str, *, http: httpx.AsyncClient | None = None) -> None:
        self._client_id = client_id
        self._owns_http = http is None
        self._http = http or httpx.AsyncClient(timeout=_TIMEOUT, trust_env=False)

    async def aclose(self) -> None:
        if self._owns_http:
            await self._http.aclose()

    async def _post(self, url: str, form: dict[str, str]) -> dict[str, Any]:
        try:
            resp = await self._http.post(url, data=form, headers={"Accept": "application/json"})
        except httpx.HTTPError as exc:
            raise GitHubSignInError("Could not reach GitHub to sign in") from exc
        try:
            data = resp.json()
        except ValueError as exc:
            raise GitHubSignInError(
                f"GitHub returned an unexpected reply ({resp.status_code})"
            ) from exc
        if not isinstance(data, dict):
            raise GitHubSignInError("GitHub returned an unexpected reply")
        if resp.status_code >= 400 and "error" not in data:
            raise GitHubSignInError(f"GitHub sign-in failed (HTTP {resp.status_code})")
        return data

    async def start(self, *, include_private: bool) -> DeviceCode:
        """Ask GitHub for a user code to show the user."""
        form = {"client_id": self._client_id}
        if include_private:
            form["scope"] = PRIVATE_REPO_SCOPE
        data = await self._post(_DEVICE_CODE_URL, form)
        error = str(data.get("error") or "")
        if error:
            raise GitHubSignInError(_FATAL_ERRORS.get(error, f"GitHub sign-in failed: {error}"))
        try:
            return DeviceCode(
                device_code=str(data["device_code"]),
                user_code=str(data["user_code"]),
                verification_uri=str(data.get("verification_uri") or ""),
                expires_in=int(data.get("expires_in") or 900),
                interval=int(data.get("interval") or 5),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise GitHubSignInError("GitHub returned an incomplete device code") from exc

    async def poll(self, device_code: str) -> DevicePoll:
        """Ask once whether the user has approved the code yet."""
        data = await self._post(
            _TOKEN_URL,
            {"client_id": self._client_id, "device_code": device_code, "grant_type": _DEVICE_GRANT},
        )
        token = data.get("access_token")
        if isinstance(token, str) and token:
            return DevicePoll(status="connected", access_token=token)
        error = str(data.get("error") or "")
        if error == "authorization_pending":
            return DevicePoll(status="pending")
        if error == "slow_down":
            return DevicePoll(status="slow_down", interval=int(data.get("interval") or 10))
        if error == "expired_token":
            return DevicePoll(status="expired")
        if error == "access_denied":
            return DevicePoll(status="denied")
        raise GitHubSignInError(_FATAL_ERRORS.get(error, f"GitHub sign-in failed: {error}"))

    async def fetch_login(self, access_token: str) -> str:
        """The signed-in user's login, for display ("" if it cannot be read)."""
        try:
            resp = await self._http.get(
                _USER_URL,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/vnd.github+json",
                },
            )
            data = resp.json() if resp.status_code == 200 else {}
        except (httpx.HTTPError, ValueError):
            return ""
        login = data.get("login") if isinstance(data, dict) else None
        return login if isinstance(login, str) else ""
