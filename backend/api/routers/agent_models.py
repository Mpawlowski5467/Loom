"""``/api/settings/agent-models`` — per-agent chat provider/model overrides.

Overrides persist in ``GlobalConfig.agent_models`` (config.yaml). Saving
re-runs the agent init path so the new bindings take effect immediately,
mirroring how provider-settings saves rebind agents.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from api.routers.agents_registry import SYSTEM_AGENTS, _load_custom
from api.routers.providers import _KNOWN
from core.config import AgentModelOverride, GlobalConfig, settings
from core.rate_limit import WRITE_LIMIT, limiter
from core.vault import VaultManager, get_vault_manager

router = APIRouter(prefix="/api/settings/agent-models", tags=["agent-models"])

_SYSTEM_IDS = {str(a["id"]) for a in SYSTEM_AGENTS}


class AgentModelEntry(BaseModel):
    """One agent's effective chat binding ("" = global default)."""

    id: str
    name: str
    icon: str
    layer: str
    system: bool
    provider: str = ""
    chat_model: str = ""
    role: str = ""
    uses_model: bool = True


class AgentModelsResponse(BaseModel):
    agents: list[AgentModelEntry]
    default_provider: str


class OverrideInput(BaseModel):
    provider: str | None = None
    chat_model: str | None = None


class PutOverridesRequest(BaseModel):
    """Replacement map for all overrides or the built-in-agent subset."""

    overrides: dict[str, OverrideInput] = Field(default_factory=dict)
    scope: Literal["all", "system"] = "all"


def _override_fields(override: AgentModelOverride | None) -> tuple[str, str]:
    if override is None:
        return "", ""
    return override.provider or "", override.chat_model or ""


def _collect(cfg: GlobalConfig, vm: VaultManager) -> AgentModelsResponse:
    """Merge built-in + custom agents with the persisted overrides."""
    entries: list[AgentModelEntry] = []
    for raw in SYSTEM_AGENTS:
        provider, chat_model = _override_fields(cfg.agent_models.get(str(raw["id"])))
        entries.append(
            AgentModelEntry(
                id=str(raw["id"]),
                name=str(raw.get("name", raw["id"])),
                icon=str(raw.get("icon", "✦")),
                layer=str(raw.get("layer", "loom")),
                system=True,
                provider=provider,
                chat_model=chat_model,
                role=str(raw.get("role", "")),
                uses_model=str(raw["id"]) != "archivist",
            )
        )
    for raw in _load_custom(vm):
        agent_id = str(raw["id"])
        if agent_id in _SYSTEM_IDS:
            continue
        provider, chat_model = _override_fields(cfg.agent_models.get(agent_id))
        # Report only the agent_models override here — NOT the agents.yaml
        # record fields. This endpoint round-trips its GET back through PUT as
        # the full override map, so merging record fields in would silently
        # promote them to overrides that then shadow later edits made in the
        # Board's agent modal. The record fields still bind at run time as
        # lower-priority fallbacks (see runner._get_chat_provider).
        entries.append(
            AgentModelEntry(
                id=agent_id,
                name=str(raw.get("name", agent_id)),
                icon=str(raw.get("icon", "✦")),
                layer=str(raw.get("layer", "shuttle")),
                system=False,
                provider=provider,
                chat_model=chat_model,
                role=str(raw.get("role", "")),
            )
        )
    return AgentModelsResponse(
        agents=entries,
        default_provider=cfg.chat_provider or cfg.default_provider,
    )


@router.get("", response_model=AgentModelsResponse)
async def get_agent_models(
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> AgentModelsResponse:
    """List every agent with its current provider/model override."""
    cfg = GlobalConfig.load(settings.config_path)
    return _collect(cfg, vm)


@router.put("", response_model=AgentModelsResponse)
@limiter.limit(WRITE_LIMIT)
async def put_agent_models(
    request: Request,  # noqa: ARG001 — required by slowapi
    body: PutOverridesRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> AgentModelsResponse:
    """Replace the requested override scope and rebind agents immediately."""
    overrides: dict[str, AgentModelOverride] = {}
    for agent_id, item in body.overrides.items():
        if body.scope == "system" and agent_id not in _SYSTEM_IDS:
            raise HTTPException(
                status_code=422,
                detail=f"Agent '{agent_id}' is not a built-in agent.",
            )
        provider = (item.provider or "").strip() or None
        chat_model = (item.chat_model or "").strip() or None
        if provider is not None and provider not in _KNOWN:
            raise HTTPException(
                status_code=422,
                detail=f"Unknown provider '{provider}' for agent '{agent_id}'. "
                f"Known: {', '.join(_KNOWN)}.",
            )
        if provider is None and chat_model is None:
            continue
        overrides[agent_id] = AgentModelOverride(provider=provider, chat_model=chat_model)

    cfg = GlobalConfig.load(settings.config_path)
    if body.scope == "system":
        # Settings owns built-in bindings only. Preserve custom-agent overrides
        # managed by their Add/Edit Agent flow so a built-in save cannot erase
        # or silently shadow those user choices.
        custom_overrides = {
            agent_id: override
            for agent_id, override in cfg.agent_models.items()
            if agent_id not in _SYSTEM_IDS
        }
        custom_overrides.update(overrides)
        overrides = custom_overrides
    cfg.agent_models = overrides
    cfg.save(settings.config_path)

    # Rebind agents so the overrides take effect without a restart. Imported
    # locally to avoid an import cycle (api.runtime pulls in a large graph).
    from api.runtime import reinit_providers_dependent_services

    reinit_providers_dependent_services(vm.active_vault_dir())

    return _collect(cfg, vm)
