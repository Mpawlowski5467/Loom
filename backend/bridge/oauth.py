"""Shared plumbing for the OAuth calendar bridges (Google, Outlook).

Both adapters run the same localhost authorization-code flow: the settings UI
asks the backend for an authorization URL carrying a single-use ``state``
nonce, the provider redirects the browser to a backend callback on this
machine, and the callback exchanges the code for tokens. Tokens live in a
per-adapter JSON file next to ``config.yaml`` with every secret value
Fernet-encrypted (``enc:v1:`` prefix, :mod:`core.secrets`) — the same at-rest
posture as provider API keys in ``config.yaml``.

The flow-state store is process-local by design (a restart invalidating an
in-flight login is safer than persisting flow state); states are single-use
and time-bounded. Token files and state nonces are never logged.
"""

from __future__ import annotations

import base64
import hashlib
import ipaddress
import json
import logging
import secrets
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

#: Lifetime of one in-flight OAuth flow (state nonce validity window).
FLOW_TTL_SECONDS = 10 * 60


@dataclass(slots=True)
class OAuthTokens:
    """One account's OAuth material; secrets are encrypted only at rest."""

    access_token: str
    refresh_token: str
    expires_at: float  # epoch seconds after which the access token is stale
    account: str = ""
    scopes: list[str] = field(default_factory=list)
    # The OAuth app (client ID) that issued these tokens. Refreshes must use
    # the same app, so this decides between the built-in and a custom one.
    # Empty for tokens saved before it was recorded (always a custom app).
    client_id: str = ""

    def access_token_fresh(self, *, skew_seconds: float = 120.0) -> bool:
        """Whether the access token is usable without a refresh round-trip."""
        return bool(self.access_token) and time.time() < self.expires_at - skew_seconds


def load_tokens(path: Path) -> OAuthTokens | None:
    """Read and decrypt a token file; a missing/corrupt/anemic file is ``None``."""
    try:
        data: Any = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    from core.secrets import decrypt

    access = decrypt(str(data.get("access_token") or "")) or ""
    refresh = decrypt(str(data.get("refresh_token") or "")) or ""
    if not access or not refresh:
        return None
    try:
        expires_at = float(data.get("expires_at") or 0.0)
    except (TypeError, ValueError):
        expires_at = 0.0
    account = data.get("account")
    scopes = data.get("scopes")
    client_id = data.get("client_id")
    return OAuthTokens(
        access_token=access,
        refresh_token=refresh,
        expires_at=expires_at,
        account=account if isinstance(account, str) else "",
        scopes=[str(scope) for scope in scopes] if isinstance(scopes, list) else [],
        client_id=client_id if isinstance(client_id, str) else "",
    )


def save_tokens(path: Path, tokens: OAuthTokens) -> None:
    """Encrypt and atomically persist a token file next to ``config.yaml``."""
    from core.secrets import encrypt

    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "access_token": encrypt(tokens.access_token),
        "refresh_token": encrypt(tokens.refresh_token),
        "expires_at": tokens.expires_at,
        "account": tokens.account,
        "scopes": list(tokens.scopes),
        "client_id": tokens.client_id,
    }
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    tmp.replace(path)


def clear_tokens(path: Path) -> None:
    """Remove the token file if present (disconnect)."""
    try:
        path.unlink()
    except FileNotFoundError:
        return
    except OSError:
        logger.warning("Could not remove OAuth token file %s", path, exc_info=True)


# ---------------------------------------------------------------------------
# Flow-state store (CSRF protection for the localhost redirect flow)
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class PendingFlow:
    """What a callback needs to finish the flow it belongs to."""

    code_verifier: str  # PKCE verifier sent with the code exchange
    client_id: str  # the app the flow started with; the exchange must match


@dataclass(frozen=True, slots=True)
class _Flow:
    deadline: float
    pending: PendingFlow


_FLOWS: dict[str, _Flow] = {}
_FLOWS_LOCK = threading.Lock()


def pkce_pair() -> tuple[str, str]:
    """Return a PKCE ``(code_verifier, code_challenge)`` pair using S256.

    PKCE binds the authorization code to this process, which is what makes a
    built-in app safe to ship: its client secret (if any) is public.
    """
    verifier = secrets.token_urlsafe(64)  # 86 chars of the RFC 7636 alphabet
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def new_flow_state(adapter: str, *, code_verifier: str = "", client_id: str = "") -> str:
    """Create a single-use, time-bounded CSRF state for an adapter flow."""
    state = secrets.token_urlsafe(32)
    now = time.monotonic()
    with _FLOWS_LOCK:
        expired = [key for key, flow in _FLOWS.items() if flow.deadline <= now]
        for key in expired:
            _FLOWS.pop(key, None)
        _FLOWS[f"{adapter}:{state}"] = _Flow(
            deadline=now + FLOW_TTL_SECONDS,
            pending=PendingFlow(code_verifier=code_verifier, client_id=client_id),
        )
    return state


def consume_flow(adapter: str, state: str) -> PendingFlow | None:
    """Atomically consume a live state; expired/unknown states return ``None``."""
    with _FLOWS_LOCK:
        flow = _FLOWS.pop(f"{adapter}:{state}", None)
    if flow is None or flow.deadline <= time.monotonic():
        return None
    return flow.pending


def consume_flow_state(adapter: str, state: str) -> bool:
    """Atomically consume a live state; expired/unknown states are rejected."""
    return consume_flow(adapter, state) is not None


def reset_flow_states() -> None:
    """Clear all in-flight flows (test teardown)."""
    with _FLOWS_LOCK:
        _FLOWS.clear()


def is_loopback_host(host: str | None) -> bool:
    """Whether *host* names this machine (localhost, *.localhost, loopback IP)."""
    if not host:
        return False
    normalized = host.rstrip(".").lower()
    if normalized == "localhost" or normalized.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(normalized).is_loopback
    except ValueError:
        return False
