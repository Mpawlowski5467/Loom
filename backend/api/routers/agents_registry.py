"""Custom-agent registry CRUD.

System agents (Loom Layer + Shuttle Layer) live in a hardcoded registry
below. Custom agents persist to ``agents.yaml`` next to vault.yaml so
they survive restarts.

This router is intentionally separate from ``agents.py`` (which exposes
agent runtime status / changelog). It does NOT wire custom agents to
execution — they are display-only until a future ticket extends the
runner (see G4 scope guardrails).
"""

from __future__ import annotations

import logging
import secrets
import time
from pathlib import Path

import yaml
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from core.exceptions import ProviderConfigError, ProviderError
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


# -- Round-Table bubble cache -------------------------------------------------

_BUBBLE_TTL_SECONDS = 300
_bubble_cache: dict[tuple[str, str], tuple[float, str]] = {}


class BubbleResponse(BaseModel):
    agent_id: str
    bubble: str
    cached: bool


def _find_agent(vm: VaultManager, agent_id: str) -> dict | None:
    for a in SYSTEM_AGENTS:
        if a["id"] == agent_id:
            return a
    for a in _load_custom(vm):
        if a.get("id") == agent_id:
            return a
    return None


@router.get("/{agent_id}/bubble", response_model=BubbleResponse)
@limiter.limit(READ_LIMIT)
async def get_bubble(
    request: Request,  # noqa: ARG001 — required by slowapi
    agent_id: str,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> BubbleResponse:
    """Return a one-sentence agent take on the current vault state.

    Cached per (agent, vault) for ~5 minutes so the Round-Table view doesn't
    burn tokens on every render.
    """
    agent = _find_agent(vm, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")

    vault_name = vm.get_active_vault()
    key = (agent_id, vault_name)
    now = time.monotonic()
    cached = _bubble_cache.get(key)
    if cached and now - cached[0] < _BUBBLE_TTL_SECONDS:
        return BubbleResponse(agent_id=agent_id, bubble=cached[1], cached=True)

    from core.providers import get_chat_provider

    try:
        provider = get_chat_provider()
    except (ProviderConfigError, ProviderError):
        # Provider not configured — return a graceful default so the UI still
        # has something to show in the bubble.
        fallback = f"{agent.get('role', 'on duty')}."
        return BubbleResponse(agent_id=agent_id, bubble=fallback, cached=False)

    system = agent.get("system_prompt") or (f"You are {agent.get('name', agent_id)}, a Loom agent.")
    user = (
        "In one sentence, what's your current view on the state of the vault? "
        "Keep it under 18 words. Write in first person, no preamble."
    )

    # Tag the trace so the bubble call shows up as e.g. "bubble:weaver"
    # in TraceFeed instead of empty-caller. Distinct from "weaver" (the
    # captures pipeline) so the two paths are unambiguous in the log.
    from core.traces import clear_caller, set_caller

    try:
        set_caller(f"bubble:{agent_id}")
        reply = await provider.chat(
            messages=[{"role": "user", "content": user}],
            system=system,
        )
    except (ProviderError, ProviderConfigError) as exc:
        logger.warning("bubble generation failed for %s: %s", agent_id, exc)
        fallback = f"{agent.get('role', 'on duty')}."
        return BubbleResponse(agent_id=agent_id, bubble=fallback, cached=False)
    finally:
        clear_caller()

    text = reply.strip().splitlines()[0] if reply else ""
    if not text:
        text = f"{agent.get('role', 'on duty')}."
    _bubble_cache[key] = (now, text)
    return BubbleResponse(agent_id=agent_id, bubble=text, cached=False)


# -- Round-Table: ask one agent a user-supplied question ----------------------


class AskAgentRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=1000)


class AskAgentResponse(BaseModel):
    agent_id: str
    reply: str
    trace_id: str = ""
    error: str = ""


@router.post("/{agent_id}/ask", response_model=AskAgentResponse)
@limiter.limit(WRITE_LIMIT)
async def ask_agent(
    request: Request,  # noqa: ARG001 — required by slowapi
    agent_id: str,
    body: AskAgentRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> AskAgentResponse:
    """Ask a single agent a question through its persona.

    Used by the Round Table view to dispatch one user question to every
    Loom agent in parallel and show each perspective side-by-side.
    """
    agent = _find_agent(vm, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")

    from core.providers import get_chat_provider

    try:
        provider = get_chat_provider()
    except (ProviderConfigError, ProviderError) as exc:
        return AskAgentResponse(agent_id=agent_id, reply="", error=str(exc))

    system = agent.get("system_prompt") or f"You are {agent.get('name', agent_id)}, a Loom agent."
    system_with_brief = (
        system
        + "\n\nAnswer the user's question from YOUR role's perspective. "
        "Be concise (2-3 sentences). No preamble. If the question is outside your role, "
        "say so plainly in one sentence."
    )

    from core.traces import clear_caller, get_trace_store, set_caller

    try:
        set_caller(f"roundtable:{agent_id}")
        reply = await provider.chat(
            messages=[{"role": "user", "content": body.question}],
            system=system_with_brief,
        )
    except (ProviderError, ProviderConfigError) as exc:
        logger.warning("round-table ask failed for %s: %s", agent_id, exc)
        return AskAgentResponse(agent_id=agent_id, reply="", error=str(exc))
    finally:
        clear_caller()

    recent = get_trace_store().list(limit=1)
    trace_id = recent[0].id if recent else ""
    return AskAgentResponse(agent_id=agent_id, reply=reply.strip(), trace_id=trace_id)
