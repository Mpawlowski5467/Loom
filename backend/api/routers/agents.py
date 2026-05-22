"""Agent management and changelog API routes."""

from __future__ import annotations

from datetime import date

import yaml
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ValidationError

from core.rate_limit import WRITE_LIMIT, limiter
from core.vault import VaultManager, VaultPathError, get_vault_manager

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


class SpiderCandidate(BaseModel):
    """A single link candidate found by Spider."""

    note_id: str
    title: str
    score: float
    decision: str  # "auto-linked", "suggested", "skipped"
    reason: str


class SpiderNoteReport(BaseModel):
    """Spider scan result for a single note."""

    source_id: str
    source_title: str
    auto_linked: list[str]
    suggested: list[str]
    skipped: int
    candidates: list[SpiderCandidate]


class SpiderScanResult(BaseModel):
    """Full result of a Spider scan (single note or vault-wide)."""

    notes_scanned: int
    total_auto_linked: int
    total_suggested: int
    total_skipped: int
    reports: list[SpiderNoteReport]


# -- Endpoints -----------------------------------------------------------------


@router.get("/agents")
def list_agents() -> list[AgentStatus]:
    """List all agents with current status, action counts, last run time."""
    from agents.runner import get_runner

    runner = get_runner()
    if runner is None:
        return []
    return [AgentStatus(**a) for a in runner.list_agents()]


# NOTE: Static paths (/agents/spider/scan, /agents/researcher/query, etc.)
# must be registered BEFORE the dynamic /agents/{agent_name}/run route.


@router.post("/agents/spider/scan")
@limiter.limit(WRITE_LIMIT)
async def spider_scan(
    request: Request,  # noqa: ARG001 — required by slowapi
    note_id: str = Query("", description="Scan a single note by ID (omit for full vault)"),
) -> SpiderScanResult:
    """Trigger Spider to find connections. Returns scored candidates and linking decisions."""
    from agents.loom.spider import get_spider

    spider = get_spider()
    if spider is None:
        raise HTTPException(status_code=503, detail="Spider agent not initialized")

    if note_id:
        # Single-note scan: resolve note path from ID
        from core.note_index import get_note_index
        from core.notes import parse_note_meta

        note_path = None
        index = get_note_index()
        if index.size > 0:
            entry = index.get_by_id(note_id)
            if entry is not None:
                note_path = entry.path
        if note_path is None:
            # Fallback: scan disk
            vm = get_vault_manager()
            threads_dir = vm.active_vault_dir() / "threads"
            for md in threads_dir.rglob("*.md"):
                if ".archive" in md.parts:
                    continue
                try:
                    meta = parse_note_meta(md)
                    if meta.id == note_id:
                        note_path = md
                        break
                except (OSError, yaml.YAMLError, ValidationError, ValueError):
                    continue
        if note_path is None:
            raise HTTPException(status_code=404, detail=f"Note not found: {note_id}")

        report = await spider.scan_and_report(note_path)
        raw = report.to_dict()
        return SpiderScanResult(
            notes_scanned=1,
            total_auto_linked=len(report.auto_linked),
            total_suggested=len(report.suggested),
            total_skipped=report.skipped,
            reports=[SpiderNoteReport(**raw)],
        )

    # Full vault scan
    vault_report = await spider.scan_vault_report()
    raw = vault_report.to_dict()
    return SpiderScanResult(
        notes_scanned=raw["notes_scanned"],
        total_auto_linked=raw["total_auto_linked"],
        total_suggested=raw["total_suggested"],
        total_skipped=raw["total_skipped"],
        reports=[SpiderNoteReport(**r) for r in raw["reports"]],
    )


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

    try:
        changelog_path = vm.changelog_path(agent, date)
    except VaultPathError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not changelog_path.exists():
        return ChangelogEntry(agent=agent, date=date, content="")

    content = changelog_path.read_text(encoding="utf-8")
    return ChangelogEntry(agent=agent, date=date, content=content)


def _today_str() -> str:
    return date.today().isoformat()
