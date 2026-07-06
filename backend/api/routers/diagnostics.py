"""Diagnostics routes for the Settings About section."""

from __future__ import annotations

import sys
import tomllib
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Request
from pydantic import BaseModel

from core.cache import get_response_cache
from core.config import GlobalConfig, settings
from core.traces import get_trace_store

router = APIRouter(prefix="/api", tags=["diagnostics"])


class DiagnosticsResponse(BaseModel):
    """Runtime diagnostics safe to expose to the local frontend."""

    app_version: str
    python_version: str
    vault_path: str
    providers_configured: list[str]
    started_at: datetime
    build_date: datetime | None
    log_path: str
    # Optional services — absent from most installs, so state is split into
    # "was it configured" vs "is it actually reachable".
    cache_configured: bool
    cache_connected: bool
    database_configured: bool
    database_connected: bool


@router.get("/diagnostics", response_model=DiagnosticsResponse)
async def get_diagnostics(request: Request) -> DiagnosticsResponse:
    """Return version, runtime, vault, and provider diagnostics."""
    config = GlobalConfig.load(settings.config_path)
    started_at = getattr(request.app.state, "started_at", None)
    if not isinstance(started_at, datetime):
        started_at = datetime.now(UTC)

    cache = get_response_cache()
    mirror = get_trace_store().pg_mirror
    return DiagnosticsResponse(
        app_version=_app_version(),
        python_version=sys.version.split()[0],
        vault_path=str(settings.vaults_dir / config.active_vault),
        providers_configured=[
            name for name, provider in config.providers.items() if provider.api_key or provider.host
        ],
        started_at=started_at,
        build_date=_build_date(),
        log_path=str(settings.loom_home / "logs"),
        cache_configured=cache is not None,
        cache_connected=bool(cache is not None and cache.connected),
        database_configured=bool(settings.database_url),
        database_connected=bool(mirror is not None and mirror.connected),
    )


def _pyproject_path() -> Path:
    return Path(__file__).resolve().parents[2] / "pyproject.toml"


def _app_version() -> str:
    try:
        data = tomllib.loads(_pyproject_path().read_text())
        project = data.get("project", {})
        version = project.get("version")
        if isinstance(version, str):
            return version
    except (OSError, tomllib.TOMLDecodeError):
        pass
    return "0.0.0"


def _build_date() -> datetime | None:
    """Best-effort build/install timestamp.

    No CI artifact ships with this repo, so we read the mtime of
    pyproject.toml — it's the closest stable proxy for "when this build was
    cut" without adding a build step.
    """
    try:
        return datetime.fromtimestamp(_pyproject_path().stat().st_mtime, tz=UTC)
    except OSError:
        return None
