"""Agent management and changelog API routes."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from core.vault import VaultManager, get_vault_manager

router = APIRouter(prefix="/api", tags=["agents"])


# -- Response models -----------------------------------------------------------


class AgentStatus(BaseModel):
    """Status of a single agent."""

    name: str
    role: str
    enabled: bool
    trust_level: str
    action_count: int
    last_action: str | None


class RunResult(BaseModel):
    """Result of triggering an agent run."""

    agent: str
    result: dict


class ChangelogEntry(BaseModel):
    """A single changelog day for an agent."""

    agent: str
    date: str
    content: str


# -- Endpoints -----------------------------------------------------------------


@router.get("/agents")
def list_agents() -> list[AgentStatus]:
    """List all agents with current status, action counts, last run time."""
    from agents.runner import get_runner

    runner = get_runner()
    if runner is None:
        return []
    return [AgentStatus(**a) for a in runner.list_agents()]


@router.post("/agents/{agent_name}/run")
async def run_agent(
    agent_name: str,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> RunResult:
    """Manually trigger a scheduled agent run."""
    from agents.runner import get_runner

    runner = get_runner()
    if runner is None:
        raise HTTPException(status_code=503, detail="Agent runner not initialized")

    result = await runner.run_scheduled(agent_name)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return RunResult(agent=agent_name, result=result)


@router.get("/changelog")
def get_changelog(
    agent: str = Query(..., description="Agent name"),
    date: str = Query("", description="Date (YYYY-MM-DD), defaults to today"),
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> ChangelogEntry:
    """Fetch changelog entries for an agent on a given date."""
    if not date:
        date = _today_str()

    vault_dir = vm.active_vault_dir()
    changelog_path = vault_dir / ".loom" / "changelog" / agent / f"{date}.md"

    if not changelog_path.exists():
        return ChangelogEntry(agent=agent, date=date, content="")

    content = changelog_path.read_text(encoding="utf-8")
    return ChangelogEntry(agent=agent, date=date, content=content)


def _today_str() -> str:
    return date.today().isoformat()
