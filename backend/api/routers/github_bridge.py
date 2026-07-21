"""GitHub Bridge endpoints: connection config, test, and manual sync.

Lives under ``/api/automations/github`` alongside the Standup/Calendar
automations. The token follows the provider-key UX: the API never returns
it, an empty PATCH value means "no change", and it is Fernet-encrypted at
rest by the config layer.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from bridge.github import GitHubClient, GitHubError
from bridge.github_service import (
    GitHubSyncConflictError,
    GitHubSyncResult,
    get_github_sync_service,
    sync_github,
)
from core.capture_jobs import CaptureJobsBusyError
from core.config import GitHubBridgeConfig, GitHubBridgeConfigPublic, GlobalConfig
from core.rate_limit import WRITE_LIMIT, limiter
from core.vault import VaultManager, get_vault_manager

router = APIRouter(prefix="/api/automations/github", tags=["github-bridge"])


class GitHubBridgePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = None
    token: str | None = None
    clear_token: bool = False
    repos: list[str] | None = None
    interval_minutes: int | None = Field(default=None, ge=5, le=1440)
    lookback_hours: int | None = Field(default=None, ge=1, le=720)
    include_commits: bool | None = None
    include_issues: bool | None = None
    include_pull_requests: bool | None = None


class GitHubAutomationResponse(BaseModel):
    github: GitHubBridgeConfigPublic
    status: dict[str, Any]


class RepoTestResult(BaseModel):
    repo: str
    ok: bool
    private: bool = False
    description: str = ""
    default_branch: str = ""
    pushed_at: str = ""
    error: str = ""


class GitHubTestResponse(BaseModel):
    repos: list[RepoTestResult]


def _response(config: GlobalConfig) -> GitHubAutomationResponse:
    return GitHubAutomationResponse(
        github=config.github.to_public(),
        status=get_github_sync_service().status(),
    )


def _validation_detail(exc: ValidationError) -> str:
    """Format validation failures without echoing private submitted values."""
    messages = [
        str(error.get("msg") or "Invalid GitHub setting")
        for error in exc.errors(
            include_url=False,
            include_context=False,
            include_input=False,
        )
    ]
    return "; ".join(messages) or "Invalid GitHub setting"


@router.get("", response_model=GitHubAutomationResponse)
def get_github_automation(
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> GitHubAutomationResponse:
    """Return the redacted GitHub connection and poller status."""
    return _response(GlobalConfig.load(vm.config_path()))


@router.patch("", response_model=GitHubAutomationResponse)
@limiter.limit(WRITE_LIMIT)
async def patch_github_automation(
    request: Request,  # noqa: ARG001 — required by slowapi
    body: GitHubBridgePatch,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> GitHubAutomationResponse:
    """Validate, persist, and immediately apply GitHub bridge settings."""
    config = GlobalConfig.load(vm.config_path())
    updates = body.model_dump(exclude_none=True, exclude={"clear_token"})
    if body.clear_token:
        updates["token"] = None
    try:
        config.github = GitHubBridgeConfig.model_validate({**config.github.model_dump(), **updates})
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=_validation_detail(exc)) from exc
    if config.github.enabled and not config.github.repos:
        raise HTTPException(
            status_code=422, detail="At least one repository is required when enabled"
        )
    config.save(vm.config_path())
    get_github_sync_service().notify()
    return _response(config)


@router.post("/test", response_model=GitHubTestResponse)
@limiter.limit(WRITE_LIMIT)
async def test_github_connection(
    request: Request,  # noqa: ARG001 — required by slowapi
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> GitHubTestResponse:
    """Validate the token and each configured repo with a metadata fetch."""
    config = GlobalConfig.load(vm.config_path())
    gh = config.github
    if not gh.repos:
        raise HTTPException(status_code=409, detail="Add at least one repository first")
    client = GitHubClient(gh.token)
    results: list[RepoTestResult] = []
    try:
        for repo in gh.repos[:10]:
            try:
                info = await client.validate_repo(repo)
                results.append(RepoTestResult(ok=True, **info))
            except GitHubError as exc:
                results.append(RepoTestResult(repo=repo, ok=False, error=str(exc)))
    finally:
        await client.aclose()
    return GitHubTestResponse(repos=results)


@router.post("/sync", response_model=GitHubSyncResult)
@limiter.limit(WRITE_LIMIT)
async def sync_github_now(
    request: Request,  # noqa: ARG001 — required by slowapi
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> GitHubSyncResult:
    """Poll all configured repos once and ingest activity into the Inbox."""
    config = GlobalConfig.load(vm.config_path())
    if not config.github.repos:
        raise HTTPException(status_code=409, detail="Add at least one repository first")
    try:
        return await sync_github(vm=vm)
    except GitHubError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except (GitHubSyncConflictError, CaptureJobsBusyError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
