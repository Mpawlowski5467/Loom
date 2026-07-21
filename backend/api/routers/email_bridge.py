"""Email Bridge endpoints: connection config, test, and manual sync.

Lives under ``/api/automations/email``. The password follows the same UX as
provider keys and the GitHub token: never returned, an empty PATCH value
means "no change", Fernet-encrypted at rest.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from bridge.email import EmailClient, EmailError
from bridge.email_service import (
    EmailSyncConflictError,
    EmailSyncResult,
    get_email_sync_service,
    sync_email,
)
from core.capture_jobs import CaptureJobsBusyError
from core.config import EmailBridgeConfig, EmailBridgeConfigPublic, GlobalConfig
from core.rate_limit import WRITE_LIMIT, limiter
from core.vault import VaultManager, get_vault_manager

router = APIRouter(prefix="/api/automations/email", tags=["email-bridge"])


class EmailBridgePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = None
    host: str | None = None
    port: int | None = Field(default=None, ge=1, le=65535)
    use_ssl: bool | None = None
    username: str | None = None
    password: str | None = None
    clear_password: bool = False
    folder: str | None = None
    interval_minutes: int | None = Field(default=None, ge=5, le=1440)
    lookback_hours: int | None = Field(default=None, ge=1, le=720)
    max_messages_per_poll: int | None = Field(default=None, ge=1, le=100)


class EmailAutomationResponse(BaseModel):
    email: EmailBridgeConfigPublic
    status: dict[str, Any]


class EmailTestResponse(BaseModel):
    ok: bool
    folder: str = ""
    messages: int = 0
    error: str = ""


def _response(config: GlobalConfig) -> EmailAutomationResponse:
    return EmailAutomationResponse(
        email=config.email.to_public(),
        status=get_email_sync_service().status(),
    )


def _validation_detail(exc: ValidationError) -> str:
    """Format validation failures without echoing private submitted values."""
    messages = [
        str(error.get("msg") or "Invalid email setting")
        for error in exc.errors(
            include_url=False,
            include_context=False,
            include_input=False,
        )
    ]
    return "; ".join(messages) or "Invalid email setting"


def _incomplete(config: EmailBridgeConfig) -> bool:
    return not (config.host and config.username and config.password)


@router.get("", response_model=EmailAutomationResponse)
def get_email_automation(
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> EmailAutomationResponse:
    """Return the redacted email connection and poller status."""
    return _response(GlobalConfig.load(vm.config_path()))


@router.patch("", response_model=EmailAutomationResponse)
@limiter.limit(WRITE_LIMIT)
async def patch_email_automation(
    request: Request,  # noqa: ARG001 — required by slowapi
    body: EmailBridgePatch,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> EmailAutomationResponse:
    """Validate, persist, and immediately apply email bridge settings."""
    config = GlobalConfig.load(vm.config_path())
    updates = body.model_dump(exclude_none=True, exclude={"clear_password"})
    if body.clear_password:
        updates["password"] = None
    try:
        config.email = EmailBridgeConfig.model_validate({**config.email.model_dump(), **updates})
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=_validation_detail(exc)) from exc
    if config.email.enabled and _incomplete(config.email):
        raise HTTPException(
            status_code=422,
            detail="IMAP host, username, and password are required when enabled",
        )
    config.save(vm.config_path())
    get_email_sync_service().notify()
    return _response(config)


@router.post("/test", response_model=EmailTestResponse)
@limiter.limit(WRITE_LIMIT)
async def test_email_connection(
    request: Request,  # noqa: ARG001 — required by slowapi
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> EmailTestResponse:
    """Connect, log in, and open the configured folder read-only."""
    config = GlobalConfig.load(vm.config_path())
    mail = config.email
    if _incomplete(mail):
        raise HTTPException(
            status_code=409, detail="Configure the IMAP host, username, and password first"
        )
    client = EmailClient(
        mail.host, mail.port, mail.username, str(mail.password), use_ssl=mail.use_ssl
    )
    try:
        async with client:
            info = await client.validate(mail.folder)
        return EmailTestResponse(ok=True, **info)
    except EmailError as exc:
        return EmailTestResponse(ok=False, error=str(exc))


@router.post("/sync", response_model=EmailSyncResult)
@limiter.limit(WRITE_LIMIT)
async def sync_email_now(
    request: Request,  # noqa: ARG001 — required by slowapi
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> EmailSyncResult:
    """Poll the configured mailbox once and ingest new mail into the Inbox."""
    config = GlobalConfig.load(vm.config_path())
    if _incomplete(config.email):
        raise HTTPException(
            status_code=409, detail="Configure the IMAP host, username, and password first"
        )
    try:
        return await sync_email(vm=vm)
    except EmailError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except (EmailSyncConflictError, CaptureJobsBusyError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
