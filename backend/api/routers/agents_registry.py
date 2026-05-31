"""Custom-agent registry CRUD.

System agents (Loom Layer + Shuttle Layer) live in a hardcoded registry
below. Custom agents persist to ``agents.yaml`` next to vault.yaml so
they survive restarts.

This router is intentionally separate from ``agents.py`` (which exposes
agent runtime status / changelog). Custom agents ARE executable: running
one (``POST /api/agents/{id}/run``) dispatches through ``AgentRunner`` to
``agents.shuttle.custom.CustomAgent``, which writes a capture for triage.
"""

from __future__ import annotations

import logging
import secrets
from pathlib import Path

import yaml
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from core.rate_limit import READ_LIMIT, WRITE_LIMIT, limiter
from core.vault import VaultManager, get_vault_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agents/registry", tags=["agents-registry"])

AGENTS_FILE = "agents.yaml"

SYSTEM_AGENTS: list[dict] = [
    {
        "id": "weaver",
        "name": "weaver",
        "layer": "loom",
        "role": "creates notes from captures",
        "icon": "🧶",
        "system_prompt": (
            "You are Weaver, the Loom agent that turns captures into proper "
            "notes. You read the capture, decide on type/folder/title, and "
            "weave links to related vault notes. Speak in first person, terse "
            "and concrete, like a craftsperson at a desk."
        ),
    },
    {
        "id": "spider",
        "name": "spider",
        "layer": "loom",
        "role": "auto-links across the vault",
        "icon": "🕸",
        "system_prompt": (
            "You are Spider, the Loom agent that auto-links notes across the "
            "vault. You track wikilinks, surface candidate connections, and "
            "weigh confidence. Speak quietly, with an eye for patterns."
        ),
    },
    {
        "id": "archivist",
        "name": "archivist",
        "layer": "loom",
        "role": "folder hygiene & cleanup",
        "icon": "📦",
        "system_prompt": (
            "You are Archivist, the Loom agent responsible for folder hygiene, "
            "moves, renames, and archival. You keep the vault tidy. Speak "
            "plainly, slightly bureaucratic but kind."
        ),
    },
    {
        "id": "scribe",
        "name": "scribe",
        "layer": "loom",
        "role": "generates summaries",
        "icon": "✎",
        "system_prompt": (
            "You are Scribe, the Loom agent that writes summaries and daily "
            "logs. You distill threads down to their essence. Speak with the "
            "warmth of someone keeping a journal."
        ),
    },
    {
        "id": "sentinel",
        "name": "sentinel",
        "layer": "loom",
        "role": "validates edits before commit",
        "icon": "👁",
        "system_prompt": (
            "You are Sentinel, the Loom agent that validates edits before "
            "they land. You catch duplicates, broken links, and schema drift. "
            "Speak watchful and concise."
        ),
    },
    {
        "id": "researcher",
        "name": "researcher",
        "layer": "shuttle",
        "role": "queries the web and synthesizes",
        "icon": "🔎",
        "system_prompt": (
            "You are Researcher, a Shuttle agent. You answer questions using "
            "the vault and external sources, drafting captures for review. "
            "Speak curious and direct."
        ),
    },
    {
        "id": "standup",
        "name": "standup",
        "layer": "shuttle",
        "role": "daily recap & planning",
        "icon": "📋",
        "system_prompt": (
            "You are Standup, a Shuttle agent. You produce daily recaps from "
            "changelogs and surface what shifted. Speak like a clear-headed "
            "morning briefing."
        ),
    },
]

_SYSTEM_IDS = {a["id"] for a in SYSTEM_AGENTS}


class AgentRecord(BaseModel):
    id: str
    name: str
    layer: str
    role: str
    icon: str
    system_prompt: str = ""
    system: bool


class CustomAgentPayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=40)
    role: str = ""
    icon: str = "✦"
    system_prompt: str = ""


def _agents_path(vm: VaultManager) -> Path:
    return vm.active_vault_dir() / AGENTS_FILE


def _load_custom(vm: VaultManager) -> list[dict]:
    path = _agents_path(vm)
    if not path.exists():
        return []
    try:
        data = yaml.safe_load(path.read_text()) or {}
    except yaml.YAMLError:
        logger.warning("agents.yaml is malformed; treating as empty")
        return []
    items = data.get("agents") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []
    return [a for a in items if isinstance(a, dict) and "id" in a]


def _save_custom(vm: VaultManager, agents: list[dict]) -> None:
    path = _agents_path(vm)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump({"agents": agents}, sort_keys=False))


def _to_record(raw: dict, *, system: bool) -> AgentRecord:
    return AgentRecord(
        id=raw["id"],
        name=raw.get("name", raw["id"]),
        layer=raw.get("layer", "shuttle"),
        role=raw.get("role", ""),
        icon=raw.get("icon", "✦"),
        system_prompt=raw.get("system_prompt", ""),
        system=system,
    )


@router.get("")
@limiter.limit(READ_LIMIT)
def list_registry(
    request: Request,  # noqa: ARG001 — required by slowapi
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> list[AgentRecord]:
    out: list[AgentRecord] = [_to_record(a, system=True) for a in SYSTEM_AGENTS]
    for a in _load_custom(vm):
        if a.get("id") in _SYSTEM_IDS:
            continue
        out.append(_to_record(a, system=False))
    return out


@router.post("", status_code=201)
@limiter.limit(WRITE_LIMIT)
def create_custom(
    request: Request,  # noqa: ARG001 — required by slowapi
    body: CustomAgentPayload,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> AgentRecord:
    existing = _load_custom(vm)
    slug_base = "".join(ch.lower() if ch.isalnum() else "-" for ch in body.name).strip("-")
    if not slug_base:
        raise HTTPException(status_code=400, detail="Name must contain letters or digits")
    agent_id = slug_base
    if agent_id in _SYSTEM_IDS or any(a.get("id") == agent_id for a in existing):
        agent_id = f"{slug_base}-{secrets.token_hex(2)}"

    raw = {
        "id": agent_id,
        "name": body.name,
        "layer": "shuttle",
        "role": body.role,
        "icon": body.icon or "✦",
        "system_prompt": body.system_prompt,
    }
    existing.append(raw)
    _save_custom(vm, existing)
    return _to_record(raw, system=False)


@router.patch("/{agent_id}")
@limiter.limit(WRITE_LIMIT)
def update_custom(
    request: Request,  # noqa: ARG001 — required by slowapi
    agent_id: str,
    body: CustomAgentPayload,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> AgentRecord:
    if agent_id in _SYSTEM_IDS:
        raise HTTPException(status_code=400, detail="System agents are read-only")
    existing = _load_custom(vm)
    for raw in existing:
        if raw.get("id") == agent_id:
            raw["name"] = body.name
            raw["role"] = body.role
            raw["icon"] = body.icon or raw.get("icon", "✦")
            raw["system_prompt"] = body.system_prompt
            _save_custom(vm, existing)
            return _to_record(raw, system=False)
    raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")


@router.get("/{agent_id}", response_model=AgentRecord)
@limiter.limit(READ_LIMIT)
def get_agent(
    request: Request,  # noqa: ARG001 — required by slowapi
    agent_id: str,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> AgentRecord:
    """Fetch a single agent record (including its system_prompt) by id.

    Used by the edit-agent flow so the modal can preload the saved prompt
    instead of starting blank.
    """
    for a in SYSTEM_AGENTS:
        if a["id"] == agent_id:
            return _to_record(a, system=True)
    for a in _load_custom(vm):
        if a.get("id") == agent_id:
            return _to_record(a, system=False)
    raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")


@router.delete("/{agent_id}", status_code=204)
@limiter.limit(WRITE_LIMIT)
def delete_custom(
    request: Request,  # noqa: ARG001 — required by slowapi
    agent_id: str,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> None:
    if agent_id in _SYSTEM_IDS:
        raise HTTPException(status_code=400, detail="System agents cannot be deleted")
    existing = _load_custom(vm)
    filtered = [a for a in existing if a.get("id") != agent_id]
    if len(filtered) == len(existing):
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")
    _save_custom(vm, filtered)
    return None
