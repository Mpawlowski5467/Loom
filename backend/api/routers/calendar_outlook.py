"""Outlook Calendar OAuth bridge endpoints.

Lives under ``/api/automations/calendar/outlook``. Mirrors the Google
Calendar router: the client secret is never returned and is Fernet-encrypted
at rest; OAuth tokens live encrypted in ``outlook-cal-oauth.json`` and never
appear in any API response; the browser-facing callback is protected by a
single-use, time-bounded ``state`` nonce.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from api.routers.oauth_support import loopback_redirect_uri, oauth_result_page
from bridge.oauth import FLOW_TTL_SECONDS, consume_flow_state, new_flow_state
from bridge.outlook_cal import (
    OutlookCalendarClient,
    OutlookCalendarError,
    authorization_url,
)
from bridge.outlook_cal_service import (
    OutlookCalendarSyncConflictError,
    OutlookCalendarSyncResult,
    clear_outlook_connection,
    get_outlook_calendar_sync_service,
    load_outlook_tokens,
    save_outlook_tokens,
    sync_outlook_calendar,
)
from core.capture_jobs import CaptureJobsBusyError
from core.config import GlobalConfig, OAuthCalendarConfigPublic, OutlookCalendarConfig
from core.rate_limit import WRITE_LIMIT, limiter
from core.vault import VaultManager, get_vault_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/automations/calendar/outlook", tags=["outlook-calendar-bridge"])

_ADAPTER = "outlook-cal"
_CALLBACK_ROUTE = "outlook_calendar_oauth_callback"
_CONNECT_RATE_LIMIT = "5/minute"


class OutlookCalendarPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = None
    client_id: str | None = None
    client_secret: str | None = None
    clear_client_secret: bool = False
    interval_minutes: int | None = Field(default=None, ge=5, le=1440)
    lookback_days: int | None = Field(default=None, ge=1, le=90)
    calendar_ids: list[str] | None = None


class OAuthCalendarConnection(BaseModel):
    connected: bool
    account: str = ""


class OutlookCalendarAutomationResponse(BaseModel):
    outlook: OAuthCalendarConfigPublic
    connection: OAuthCalendarConnection
    status: dict[str, Any]


class OutlookCalendarConnectResponse(BaseModel):
    authorization_url: str
    expires_in: int


class OutlookCalendarTestResponse(BaseModel):
    ok: bool
    account: str = ""
    error: str = ""


def _response(config: GlobalConfig) -> OutlookCalendarAutomationResponse:
    tokens = load_outlook_tokens()
    return OutlookCalendarAutomationResponse(
        outlook=config.outlook_calendar.to_public(),
        connection=OAuthCalendarConnection(
            connected=tokens is not None,
            account=tokens.account if tokens is not None else "",
        ),
        status=get_outlook_calendar_sync_service().status(),
    )


def _validation_detail(exc: ValidationError) -> str:
    """Format validation failures without echoing private submitted values."""
    messages = [
        str(error.get("msg") or "Invalid Outlook Calendar setting")
        for error in exc.errors(
            include_url=False,
            include_context=False,
            include_input=False,
        )
    ]
    return "; ".join(messages) or "Invalid Outlook Calendar setting"


def _incomplete(config: OutlookCalendarConfig) -> bool:
    return not (config.client_id and config.client_secret)


def _require_app_credentials(config: GlobalConfig) -> OutlookCalendarConfig:
    outlook = config.outlook_calendar
    if _incomplete(outlook):
        raise HTTPException(
            status_code=409,
            detail="Add your Microsoft app's client ID and secret first",
        )
    return outlook


@router.get("", response_model=OutlookCalendarAutomationResponse)
def get_outlook_calendar_automation(
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> OutlookCalendarAutomationResponse:
    """Return the redacted Outlook Calendar connection and poller status."""
    return _response(GlobalConfig.load(vm.config_path()))


@router.patch("", response_model=OutlookCalendarAutomationResponse)
@limiter.limit(WRITE_LIMIT)
async def patch_outlook_calendar_automation(
    request: Request,  # noqa: ARG001 — required by slowapi
    body: OutlookCalendarPatch,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> OutlookCalendarAutomationResponse:
    """Validate, persist, and immediately apply Outlook Calendar settings."""
    config = GlobalConfig.load(vm.config_path())
    updates = body.model_dump(exclude_none=True, exclude={"clear_client_secret"})
    if body.clear_client_secret:
        updates["client_secret"] = None
    try:
        config.outlook_calendar = OutlookCalendarConfig.model_validate(
            {**config.outlook_calendar.model_dump(), **updates}
        )
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=_validation_detail(exc)) from exc
    if config.outlook_calendar.enabled and _incomplete(config.outlook_calendar):
        raise HTTPException(
            status_code=422,
            detail="A Microsoft app client ID and secret are required when enabled",
        )
    config.save(vm.config_path())
    get_outlook_calendar_sync_service().notify()
    return _response(config)


@router.post("/connect", response_model=OutlookCalendarConnectResponse)
@limiter.limit(_CONNECT_RATE_LIMIT)
async def connect_outlook_calendar(
    request: Request,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> OutlookCalendarConnectResponse:
    """Create a short-lived OAuth flow and return the Microsoft consent URL."""
    outlook = _require_app_credentials(GlobalConfig.load(vm.config_path()))
    try:
        redirect_uri = loopback_redirect_uri(request, _CALLBACK_ROUTE)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    state = new_flow_state(_ADAPTER)
    return OutlookCalendarConnectResponse(
        authorization_url=authorization_url(
            client_id=outlook.client_id,
            redirect_uri=redirect_uri,
            state=state,
        ),
        expires_in=FLOW_TTL_SECONDS,
    )


@router.get("/callback", name=_CALLBACK_ROUTE)
async def outlook_calendar_oauth_callback(
    request: Request,
    state: str | None = None,
    code: str | None = None,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> Any:
    """Consume a Microsoft callback, store tokens encrypted, wake the poller."""
    # Validate manually so FastAPI never echoes an oversized authorization code
    # in its normal structured validation response.
    if not state or not code or len(state) > 256 or len(code) > 4096:
        return oauth_result_page("Outlook Calendar", success=False)
    if not consume_flow_state(_ADAPTER, state):
        return oauth_result_page("Outlook Calendar", success=False)

    config = GlobalConfig.load(vm.config_path())
    outlook = config.outlook_calendar
    if _incomplete(outlook):
        return oauth_result_page("Outlook Calendar", success=False, error_status=409)
    client = OutlookCalendarClient(
        client_id=outlook.client_id,
        client_secret=str(outlook.client_secret),
    )
    try:
        tokens = await client.exchange_code(
            code,
            redirect_uri=str(request.url_for(_CALLBACK_ROUTE)),
        )
        try:
            tokens.account = await client.fetch_account()
        except OutlookCalendarError:
            # The account label is display-only; a lookup hiccup must not
            # fail an otherwise completed connect.
            logger.debug("Could not resolve the Outlook account label", exc_info=True)
    except OutlookCalendarError:
        logger.warning("Outlook Calendar OAuth exchange failed", exc_info=True)
        return oauth_result_page("Outlook Calendar", success=False, error_status=502)
    finally:
        await client.aclose()

    # A fresh connect replaces any prior account: wipe old tokens AND cursors
    # so the first sync of the new account starts from a clean window.
    clear_outlook_connection()
    save_outlook_tokens(tokens)
    get_outlook_calendar_sync_service().notify()
    return oauth_result_page("Outlook Calendar", success=True)


@router.post("/disconnect", response_model=OutlookCalendarAutomationResponse)
@limiter.limit(WRITE_LIMIT)
async def disconnect_outlook_calendar(
    request: Request,  # noqa: ARG001 — required by slowapi
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> OutlookCalendarAutomationResponse:
    """Wipe tokens and cursors and disable the bridge (app credentials stay)."""
    config = GlobalConfig.load(vm.config_path())
    config.outlook_calendar.enabled = False
    config.save(vm.config_path())
    clear_outlook_connection()
    get_outlook_calendar_sync_service().notify()
    return _response(config)


@router.post("/test", response_model=OutlookCalendarTestResponse)
@limiter.limit(WRITE_LIMIT)
async def test_outlook_calendar_connection(
    request: Request,  # noqa: ARG001 — required by slowapi
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> OutlookCalendarTestResponse:
    """Refresh the tokens if needed and resolve the connected account."""
    config = GlobalConfig.load(vm.config_path())
    outlook = _require_app_credentials(config)
    tokens = load_outlook_tokens()
    if tokens is None:
        raise HTTPException(status_code=409, detail="Connect your Outlook account first")
    client = OutlookCalendarClient(
        client_id=outlook.client_id,
        client_secret=str(outlook.client_secret),
        tokens=tokens,
        on_tokens=save_outlook_tokens,
    )
    try:
        await client.ensure_fresh_token()
        account = await client.fetch_account()
        if account and account != tokens.account:
            tokens.account = account
            save_outlook_tokens(tokens)
        return OutlookCalendarTestResponse(ok=True, account=account or tokens.account)
    except OutlookCalendarError as exc:
        return OutlookCalendarTestResponse(ok=False, error=str(exc))
    finally:
        await client.aclose()


@router.post("/sync", response_model=OutlookCalendarSyncResult)
@limiter.limit(WRITE_LIMIT)
async def sync_outlook_calendar_now(
    request: Request,  # noqa: ARG001 — required by slowapi
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> OutlookCalendarSyncResult:
    """Poll all configured calendars once and ingest events into the Inbox."""
    config = GlobalConfig.load(vm.config_path())
    _require_app_credentials(config)
    if load_outlook_tokens() is None:
        raise HTTPException(status_code=409, detail="Connect your Outlook account first")
    try:
        return await sync_outlook_calendar(vm=vm)
    except OutlookCalendarError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except (OutlookCalendarSyncConflictError, CaptureJobsBusyError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
