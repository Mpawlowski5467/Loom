"""Agent management and changelog API routes."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from core.rate_limit import WRITE_LIMIT, limiter
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


class ResearchRequest(BaseModel):
    """Request body for Researcher query."""

    question: str


class ResearchResponse(BaseModel):
    """Response from Researcher query."""

    answer: str
    referenced_notes: list[dict]
    capture_id: str
    capture_path: str


class StandupRequest(BaseModel):
    """Request body for Standup generation."""

    date: str = ""  # YYYY-MM-DD, defaults to today


class StandupResponse(BaseModel):
    """Response from Standup generation."""

    recap: str
    date: str
    notes_modified: int
    capture_id: str
    capture_path: str


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
@limiter.limit(WRITE_LIMIT)
async def run_agent(
    request: Request,  # noqa: ARG001 — required by slowapi
    agent_name: str,
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


@router.post("/agents/researcher/query")
@limiter.limit(WRITE_LIMIT)
async def researcher_query(request: Request, body: ResearchRequest) -> ResearchResponse:  # noqa: ARG001
    """Ask the Researcher agent a question."""
    from agents.shuttle.researcher import get_researcher

    researcher = get_researcher()
    if researcher is None:
        raise HTTPException(status_code=503, detail="Researcher agent not initialized")

    result = await researcher.query(body.question)
    return ResearchResponse(
        answer=result.answer,
        referenced_notes=result.referenced_notes,
        capture_id=result.capture_id,
        capture_path=result.capture_path,
    )


@router.post("/agents/standup/generate")
@limiter.limit(WRITE_LIMIT)
async def standup_generate(request: Request, body: StandupRequest) -> StandupResponse:  # noqa: ARG001
    """Generate a daily standup recap."""
    from agents.shuttle.standup import get_standup

    standup = get_standup()
    if standup is None:
        raise HTTPException(status_code=503, detail="Standup agent not initialized")

    target_date = None
    if body.date:
        target_date = date.fromisoformat(body.date)

    result = await standup.generate(target_date)
    return StandupResponse(
        recap=result.recap,
        date=result.date,
        notes_modified=result.notes_modified,
        capture_id=result.capture_id,
        capture_path=result.capture_path,
    )


def _today_str() -> str:
    return date.today().isoformat()
