"""Shared plumbing for the Google connector (Calendar + Gmail, one sign-in).

The connector owns exactly one OAuth token, stored encrypted in
``google-oauth.json`` next to ``config.yaml`` (see :mod:`bridge.oauth`). The
consent flow ALWAYS requests the union of both service scopes, so enabling
Calendar or Gmail later is a pure config toggle — never a re-consent. Both
service pollers refresh through this file; Google does not invalidate prior
access tokens on refresh, so the two services sharing one grant is safe for a
localhost two-service app. The legacy per-service token files
(``gcal-oauth.json`` / ``gmail-oauth.json``) are simply ignored — the
connector predates any release, so there is nothing to migrate.
"""

from __future__ import annotations

import logging
from pathlib import Path
from urllib.parse import urlencode

from bridge.oauth import OAuthTokens, clear_tokens, load_tokens, save_tokens
from bridge.oauth_apps import (
    OAuthApp,
    app_for_tokens,
    builtin_google_app,
    choose_app,
    custom_app,
    find_app,
)
from core.config import GoogleConnectorConfig, settings

logger = logging.getLogger(__name__)

_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"

#: Read-only scopes for the two Google services, requested together always.
GOOGLE_SCOPE_CALENDAR = "https://www.googleapis.com/auth/calendar.readonly"
GOOGLE_SCOPE_GMAIL = "https://www.googleapis.com/auth/gmail.readonly"
GOOGLE_CONNECTOR_SCOPES = (GOOGLE_SCOPE_CALENDAR, GOOGLE_SCOPE_GMAIL)


def authorization_url(*, client_id: str, redirect_uri: str, state: str, code_challenge: str) -> str:
    """Build the Google consent URL requesting BOTH service scopes at once.

    ``access_type=offline`` + ``prompt=consent`` guarantee a refresh token is
    returned on every connect, including re-consents. PKCE (S256) is always
    used; it is required for the built-in Desktop client and harmless for a
    custom Web client.
    """
    query = urlencode(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": " ".join(GOOGLE_CONNECTOR_SCOPES),
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
    )
    return f"{_AUTHORIZE_URL}?{query}"


def google_app(connector: GoogleConnectorConfig) -> OAuthApp | None:
    """The app a new Google sign-in uses: the user's own, else Loom's."""
    return choose_app(
        custom_app(connector.client_id, connector.client_secret), builtin_google_app()
    )


def google_app_for(connector: GoogleConnectorConfig, tokens: OAuthTokens) -> OAuthApp | None:
    """The app that issued the stored Google tokens (refreshes must use it)."""
    return app_for_tokens(
        tokens, custom_app(connector.client_id, connector.client_secret), builtin_google_app()
    )


def google_app_by_id(connector: GoogleConnectorConfig, client_id: str) -> OAuthApp | None:
    """The configured Google app with ``client_id`` (to finish a started flow)."""
    return find_app(
        client_id, custom_app(connector.client_id, connector.client_secret), builtin_google_app()
    )


def _tokens_path() -> Path:
    return Path(settings.config_path).parent / "google-oauth.json"


def load_google_tokens() -> OAuthTokens | None:
    """Return the shared Google connector tokens, if any are usable."""
    return load_tokens(_tokens_path())


def save_google_tokens(tokens: OAuthTokens) -> None:
    """Persist the shared Google connector tokens encrypted at rest."""
    save_tokens(_tokens_path(), tokens)


def clear_google_tokens() -> None:
    """Remove the shared token file (disconnect / fresh re-connect)."""
    clear_tokens(_tokens_path())
