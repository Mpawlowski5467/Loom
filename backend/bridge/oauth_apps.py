"""Which OAuth app a connector signs in with: the user's own, or Loom's.

A *custom* app is one the user registered and pasted into Settings. A
*built-in* app is registered once by whoever ships Loom and configured through
``LOOM_*_CLIENT_ID`` settings, so users connect with a single click. When
both exist the custom app wins, because configuring one is an explicit choice.

Tokens remember the client ID that issued them (:class:`OAuthTokens`), and a
refresh must use that same app, so :func:`app_for_tokens` looks the issuer up
rather than re-running the choice.
"""

from __future__ import annotations

from dataclasses import dataclass

from bridge.oauth import OAuthTokens
from core.config import settings


@dataclass(frozen=True, slots=True)
class OAuthApp:
    """One OAuth client registration."""

    client_id: str
    client_secret: str  # "" for a public client (PKCE only)
    builtin: bool


def builtin_google_app() -> OAuthApp | None:
    """Loom's Google Desktop client, if this deployment configured one."""
    if settings.google_client_id and settings.google_client_secret:
        return OAuthApp(settings.google_client_id, settings.google_client_secret, builtin=True)
    return None


def builtin_microsoft_app() -> OAuthApp | None:
    """Loom's Microsoft public client, if this deployment configured one."""
    if settings.microsoft_client_id:
        return OAuthApp(settings.microsoft_client_id, "", builtin=True)
    return None


def github_device_client_id() -> str:
    """Loom's GitHub OAuth app for device-flow sign-in ("" when absent)."""
    return settings.github_client_id


def custom_app(client_id: str, client_secret: str | None) -> OAuthApp | None:
    """The user's own app, when both halves of it are saved."""
    if client_id and client_secret:
        return OAuthApp(client_id, str(client_secret), builtin=False)
    return None


def choose_app(custom: OAuthApp | None, builtin: OAuthApp | None) -> OAuthApp | None:
    """The app a new sign-in should use: the user's own first, then Loom's."""
    return custom or builtin


def find_app(client_id: str, custom: OAuthApp | None, builtin: OAuthApp | None) -> OAuthApp | None:
    """The configured app with ``client_id``, or ``None`` if neither matches."""
    for app in (custom, builtin):
        if app is not None and client_id and app.client_id == client_id:
            return app
    return None


def app_for_tokens(
    tokens: OAuthTokens, custom: OAuthApp | None, builtin: OAuthApp | None
) -> OAuthApp | None:
    """The app that issued ``tokens``, or ``None`` if it is no longer configured.

    Tokens saved before the issuing client was recorded always came from a
    custom app, since built-in apps did not exist yet.
    """
    if not tokens.client_id:
        return custom
    return find_app(tokens.client_id, custom, builtin)
