"""Describe Loom's runtime network and secret-storage security posture."""

from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_ALLOWED_HOSTS = ("localhost", "127.0.0.1", "*.localhost", "testserver")
_LOCAL_HOSTS = {*DEFAULT_ALLOWED_HOSTS, "::1", "[::1]"}


@dataclass(frozen=True)
class SecurityPosture:
    allowed_hosts: list[str]
    local_only: bool
    api_token_configured: bool
    secret_storage: str
    warnings: list[str]


def resolve_allowed_hosts() -> list[str]:
    """Resolve TrustedHostMiddleware hosts from the environment."""
    raw = os.environ.get("LOOM_ALLOWED_HOSTS")
    if not raw:
        return list(DEFAULT_ALLOWED_HOSTS)
    hosts = [host.strip() for host in raw.split(",") if host.strip()]
    return hosts or list(DEFAULT_ALLOWED_HOSTS)


def inspect_security_posture(*, api_token: str) -> SecurityPosture:
    """Return a redaction-safe summary suitable for diagnostics and logs."""
    allowed_hosts = resolve_allowed_hosts()
    local_only = all(host.lower() in _LOCAL_HOSTS for host in allowed_hosts)
    token_configured = bool(api_token)
    secret_storage = (
        "environment-provided encryption key"
        if os.environ.get("LOOM_SECRET_KEY")
        else "machine-local encrypted file"
    )
    warnings: list[str] = []
    if not local_only and not token_configured:
        warnings.append(
            "Non-local hosts are allowed without LOOM_API_TOKEN. Keep Loom behind "
            "localhost or add an authenticated TLS reverse proxy."
        )
    elif not local_only:
        warnings.append(
            "The shared API token is defense-in-depth, not multi-user authentication. "
            "Use an authenticated TLS reverse proxy for network access."
        )
    return SecurityPosture(
        allowed_hosts=allowed_hosts,
        local_only=local_only,
        api_token_configured=token_configured,
        secret_storage=secret_storage,
        warnings=warnings,
    )
