"""Google connector endpoints: ONE sign-in for Calendar + Gmail.

Lives under ``/api/automations/google``. The client secret follows the
provider-key UX: never returned, an empty PATCH value means "no change",
Fernet-encrypted at rest. The consent flow always requests both service
scopes together; the resulting token lives encrypted in
``google-oauth.json`` (never in config, never in any API response) and is
shared by both services — enabling one later is a config toggle, not a
re-consent. The browser-facing callback is protected by a single-use,
time-bounded ``state`` nonce instead of Loom's optional API token (the
provider cannot attach that header).
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from api.routers.oauth_support import loopback_redirect_uri, oauth_result_page
from bridge.gcal import GoogleCalendarClient, GoogleCalendarError
from bridge.gcal_service import (
    GoogleCalendarSyncConflictError,
    GoogleCalendarSyncResult,
    clear_calendar_cursors,
    get_google_calendar_sync_service,
    sync_google_calendar,
)
from bridge.gmail import GmailClient, GmailError
from bridge.gmail_service import (
    GmailSyncConflictError,
    GmailSyncResult,
    clear_gmail_cursors,
    get_gmail_sync_service,
    sync_gmail,
)
from bridge.google import (
    authorization_url,
    clear_google_tokens,
    load_google_tokens,
    save_google_tokens,
)
from bridge.oauth import FLOW_TTL_SECONDS, OAuthTokens, consume_flow_state, new_flow_state
from core.capture_jobs import CaptureJobsBusyError
from core.config import (
    GlobalConfig,
    GoogleCalendarServiceConfig,
    GoogleConnectorConfig,
    GoogleConnectorConfigPublic,
    GoogleServiceConfig,
)
from core.rate_limit import WRITE_LIMIT, limiter
from core.vault import VaultManager, get_vault_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/automations/google", tags=["google-connector"])

_ADAPTER = "google"
_CALLBACK_ROUTE = "google_connector_oauth_callback"
_CONNECT_RATE_LIMIT = "5/minute"


class GoogleServicePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = None
    interval_minutes: int | None = Field(default=None, ge=5, le=1440)
    lookback_days: int | None = Field(default=None, ge=1, le=90)


class GoogleCalendarServicePatch(GoogleServicePatch):
    calendar_ids: list[str] | None = None


class GoogleConnectorPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_id: str | None = None
    client_secret: str | None = None
    clear_client_secret: bool = False
    calendar: GoogleCalendarServicePatch | None = None
    gmail: GoogleServicePatch | None = None


class OAuthConnection(BaseModel):
    connected: bool
    account: str = ""


class GoogleServicesStatus(BaseModel):
    calendar: dict[str, Any]
    gmail: dict[str, Any]


class GoogleConnectorResponse(BaseModel):
    google: GoogleConnectorConfigPublic
    connection: OAuthConnection
    services: GoogleServicesStatus


class GoogleConnectResponse(BaseModel):
    authorization_url: str
    expires_in: int


class GoogleServiceTestResult(BaseModel):
    ok: bool
    account: str = ""
    error: str = ""


class GoogleTestResponse(BaseModel):
    calendar: GoogleServiceTestResult
    gmail: GoogleServiceTestResult


def _response(config: GlobalConfig) -> GoogleConnectorResponse:
    tokens = load_google_tokens()
    return GoogleConnectorResponse(
        google=config.google.to_public(),
        connection=OAuthConnection(
            connected=tokens is not None,
            account=tokens.account if tokens is not None else "",
        ),
        services=GoogleServicesStatus(
            calendar=get_google_calendar_sync_service().status(),
            gmail=get_gmail_sync_service().status(),
        ),
    )


def _validation_detail(exc: ValidationError) -> str:
    """Format validation failures without echoing private submitted values."""
    messages = [
        str(error.get("msg") or "Invalid Google connector setting")
        for error in exc.errors(
            include_url=False,
            include_context=False,
            include_input=False,
        )
    ]
    return "; ".join(messages) or "Invalid Google connector setting"


def _incomplete(connector: GoogleConnectorConfig) -> bool:
    return not (connector.client_id and connector.client_secret)


def _require_app_credentials(config: GlobalConfig) -> GoogleConnectorConfig:
    connector = config.google
    if _incomplete(connector):
        raise HTTPException(
            status_code=409,
            detail="Add your Google OAuth client ID and secret first",
        )
    return connector


def _notify_pollers() -> None:
    get_google_calendar_sync_service().notify()
    get_gmail_sync_service().notify()


def _clear_connection_state() -> None:
    """Wipe the shared token and BOTH services' cursors."""
    clear_google_tokens()
    clear_calendar_cursors()
    clear_gmail_cursors()


@router.get("", response_model=GoogleConnectorResponse)
def get_google_connector(
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> GoogleConnectorResponse:
    """Return the redacted connector config, connection, and poller status."""
    return _response(GlobalConfig.load(vm.config_path()))


@router.patch("", response_model=GoogleConnectorResponse)
@limiter.limit(WRITE_LIMIT)
async def patch_google_connector(
    request: Request,  # noqa: ARG001 — required by slowapi
    body: GoogleConnectorPatch,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> GoogleConnectorResponse:
    """Validate, persist, and immediately apply Google connector settings."""
    config = GlobalConfig.load(vm.config_path())
    connector = config.google
    updates = body.model_dump(
        exclude_none=True, exclude={"clear_client_secret", "calendar", "gmail"}
    )
    if body.clear_client_secret:
        updates["client_secret"] = None
    try:
        if updates:
            connector = GoogleConnectorConfig.model_validate({**connector.model_dump(), **updates})
        if body.calendar is not None:
            connector.calendar = GoogleCalendarServiceConfig.model_validate(
                {**connector.calendar.model_dump(), **body.calendar.model_dump(exclude_none=True)}
            )
        if body.gmail is not None:
            connector.gmail = GoogleServiceConfig.model_validate(
                {**connector.gmail.model_dump(), **body.gmail.model_dump(exclude_none=True)}
            )
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=_validation_detail(exc)) from exc
    if (connector.calendar.enabled or connector.gmail.enabled) and _incomplete(connector):
        raise HTTPException(
            status_code=422,
            detail="A Google OAuth client ID and secret are required when a service is enabled",
        )
    config.google = connector
    config.save(vm.config_path())
    _notify_pollers()
    return _response(config)


@router.post("/connect", response_model=GoogleConnectResponse)
@limiter.limit(_CONNECT_RATE_LIMIT)
async def connect_google(
    request: Request,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> GoogleConnectResponse:
    """Create a short-lived OAuth flow consenting to BOTH service scopes."""
    connector = _require_app_credentials(GlobalConfig.load(vm.config_path()))
    try:
        redirect_uri = loopback_redirect_uri(request, _CALLBACK_ROUTE)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    state = new_flow_state(_ADAPTER)
    return GoogleConnectResponse(
        authorization_url=authorization_url(
            client_id=connector.client_id,
            redirect_uri=redirect_uri,
            state=state,
        ),
        expires_in=FLOW_TTL_SECONDS,
    )


async def _resolve_account_label(connector: GoogleConnectorConfig, tokens: OAuthTokens) -> str:
    """Best-effort account label: Gmail profile first, Calendar primary second."""
    gmail_client = GmailClient(
        client_id=connector.client_id,
        client_secret=str(connector.client_secret),
        tokens=tokens,
    )
    try:
        return await gmail_client.fetch_account()
    except GmailError:
        logger.debug("Could not resolve the account label via Gmail", exc_info=True)
    finally:
        await gmail_client.aclose()
    calendar_client = GoogleCalendarClient(
        client_id=connector.client_id,
        client_secret=str(connector.client_secret),
        tokens=tokens,
    )
    try:
        return await calendar_client.fetch_account()
    except GoogleCalendarError:
        logger.debug("Could not resolve the account label via Calendar", exc_info=True)
        return ""
    finally:
        await calendar_client.aclose()


@router.get("/callback", name=_CALLBACK_ROUTE)
async def google_connector_oauth_callback(
    request: Request,
    state: str | None = None,
    code: str | None = None,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> Any:
    """Consume a Google callback, store the shared token, wake both pollers."""
    # Validate manually so FastAPI never echoes an oversized authorization code
    # in its normal structured validation response.
    if not state or not code or len(state) > 256 or len(code) > 4096:
        return oauth_result_page("Google", success=False)
    if not consume_flow_state(_ADAPTER, state):
        return oauth_result_page("Google", success=False)

    config = GlobalConfig.load(vm.config_path())
    connector = config.google
    if _incomplete(connector):
        return oauth_result_page("Google", success=False, error_status=409)
    client = GmailClient(
        client_id=connector.client_id,
        client_secret=str(connector.client_secret),
    )
    try:
        tokens = await client.exchange_code(
            code,
            redirect_uri=str(request.url_for(_CALLBACK_ROUTE)),
        )
    except GmailError:
        logger.warning("Google OAuth exchange failed", exc_info=True)
        return oauth_result_page("Google", success=False, error_status=502)
    finally:
        await client.aclose()

    tokens.account = await _resolve_account_label(connector, tokens)

    # A fresh connect replaces any prior account: wipe the old token AND both
    # services' cursors so the first sync starts from clean windows.
    _clear_connection_state()
    save_google_tokens(tokens)
    _notify_pollers()
    return oauth_result_page("Google", success=True)


@router.post("/disconnect", response_model=GoogleConnectorResponse)
@limiter.limit(WRITE_LIMIT)
async def disconnect_google(
    request: Request,  # noqa: ARG001 — required by slowapi
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> GoogleConnectorResponse:
    """Wipe the shared token and both cursors; disable both services."""
    config = GlobalConfig.load(vm.config_path())
    config.google.calendar.enabled = False
    config.google.gmail.enabled = False
    config.save(vm.config_path())
    _clear_connection_state()
    _notify_pollers()
    return _response(config)


@router.post("/test", response_model=GoogleTestResponse)
@limiter.limit(WRITE_LIMIT)
async def test_google_connection(
    request: Request,  # noqa: ARG001 — required by slowapi
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> GoogleTestResponse:
    """Refresh the shared token if needed and probe each service's API."""
    config = GlobalConfig.load(vm.config_path())
    connector = _require_app_credentials(config)
    tokens = load_google_tokens()
    if tokens is None:
        raise HTTPException(status_code=409, detail="Connect your Google account first")

    calendar_client = GoogleCalendarClient(
        client_id=connector.client_id,
        client_secret=str(connector.client_secret),
        tokens=tokens,
        on_tokens=save_google_tokens,
    )
    try:
        # Refresh once up front; a revoked grant fails both probes the same way.
        fresh = await calendar_client.ensure_fresh_token()
        calendar_result = GoogleServiceTestResult(ok=True, account=fresh.account)
        try:
            account = await calendar_client.fetch_account()
            calendar_result.account = account or fresh.account
        except GoogleCalendarError as exc:
            calendar_result = GoogleServiceTestResult(ok=False, error=str(exc))
    except GoogleCalendarError as exc:
        fresh = tokens
        calendar_result = GoogleServiceTestResult(ok=False, error=str(exc))
    finally:
        await calendar_client.aclose()

    gmail_client = GmailClient(
        client_id=connector.client_id,
        client_secret=str(connector.client_secret),
        tokens=fresh,
        on_tokens=save_google_tokens,
    )
    try:
        account = await gmail_client.fetch_account()
        gmail_result = GoogleServiceTestResult(ok=True, account=account or fresh.account)
    except GmailError as exc:
        gmail_result = GoogleServiceTestResult(ok=False, error=str(exc))
    finally:
        await gmail_client.aclose()

    # Persist the freshest account label alongside the tokens.
    account = gmail_result.account or calendar_result.account
    if account and account != fresh.account:
        fresh.account = account
        save_google_tokens(fresh)

    return GoogleTestResponse(calendar=calendar_result, gmail=gmail_result)


@router.post("/sync/calendar", response_model=GoogleCalendarSyncResult)
@limiter.limit(WRITE_LIMIT)
async def sync_google_calendar_now(
    request: Request,  # noqa: ARG001 — required by slowapi
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> GoogleCalendarSyncResult:
    """Poll all configured calendars once and ingest events into the Inbox."""
    config = GlobalConfig.load(vm.config_path())
    _require_app_credentials(config)
    if load_google_tokens() is None:
        raise HTTPException(status_code=409, detail="Connect your Google account first")
    try:
        return await sync_google_calendar(vm=vm)
    except GoogleCalendarError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except (GoogleCalendarSyncConflictError, CaptureJobsBusyError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/sync/gmail", response_model=GmailSyncResult)
@limiter.limit(WRITE_LIMIT)
async def sync_gmail_now(
    request: Request,  # noqa: ARG001 — required by slowapi
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> GmailSyncResult:
    """Poll the mailbox window once and ingest new mail into the Inbox."""
    config = GlobalConfig.load(vm.config_path())
    _require_app_credentials(config)
    if load_google_tokens() is None:
        raise HTTPException(status_code=409, detail="Connect your Google account first")
    try:
        return await sync_gmail(vm=vm)
    except GmailError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except (GmailSyncConflictError, CaptureJobsBusyError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
