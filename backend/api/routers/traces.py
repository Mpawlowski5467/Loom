"""Traces API — inspect recorded LLM exchanges."""

from __future__ import annotations

import json
import logging
import re
from datetime import date, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from core.traces import get_trace_store
from core.vault import VaultManager, get_vault_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/traces", tags=["traces"])

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class TraceSummary(BaseModel):
    id: str
    timestamp: str
    provider: str
    model: str
    caller: str
    duration_ms: int
    error: str
    response_preview: str
    run_id: str = ""
    step: str = ""


class TraceDetail(BaseModel):
    id: str
    timestamp: str
    provider: str
    model: str
    caller: str
    system: str
    messages: list[dict]
    response: str
    duration_ms: int
    error: str
    run_id: str = ""
    step: str = ""


class RunStep(BaseModel):
    name: str
    status: str
    duration_ms: int
    trace_ids: list[str]
    error: str = ""


class RunSummary(BaseModel):
    run_id: str
    agent: str
    status: str
    started: str
    ended: str
    duration_ms: int
    steps: list[RunStep]


class RunDetail(RunSummary):
    """A run plus the full trace record for each step's LLM calls."""

    traces: dict[str, list[TraceDetail]]


def _preview(text: str, n: int = 140) -> str:
    text = text.strip().replace("\n", " ")
    return text if len(text) <= n else text[: n - 1] + "…"


@router.get("", response_model=list[TraceSummary])
def list_traces(
    limit: int = Query(50, ge=1, le=500),
    caller: str | None = Query(None, description="Filter by caller label"),
    since_id: str | None = Query(None, description="Return traces newer than this id"),
) -> list[TraceSummary]:
    """Return recent LLM calls, newest first."""
    items = get_trace_store().list(limit=limit, caller=caller, since_id=since_id)
    return [
        TraceSummary(
            id=r.id,
            timestamp=r.timestamp,
            provider=r.provider,
            model=r.model,
            caller=r.caller,
            duration_ms=r.duration_ms,
            error=r.error,
            response_preview=_preview(r.response),
            run_id=r.run_id,
            step=r.step,
        )
        for r in items
    ]


def _traces_disk_dir(vm: VaultManager) -> Path:
    return vm.active_loom_dir() / "traces"


def _read_trace_file(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        logger.debug("Failed to read trace file %s", path, exc_info=True)
        return None


def _list_dates_with_traces(traces_dir: Path) -> list[str]:
    """Return sorted (newest first) YYYY-MM-DD directory names containing traces."""
    if not traces_dir.exists():
        return []
    dates = [d.name for d in traces_dir.iterdir() if d.is_dir() and _DATE_RE.match(d.name)]
    dates.sort(reverse=True)
    return dates


@router.get("/disk", response_model=list[TraceSummary])
def list_traces_disk(
    target_date: str = Query("", alias="date", description="YYYY-MM-DD; defaults to today"),
    caller: str | None = Query(None, description="Filter by caller label"),
    limit: int = Query(100, ge=1, le=1000),
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> list[TraceSummary]:
    """Read traces persisted to disk for one calendar day.

    Used to page back beyond the 500-item in-memory ring buffer when the
    user clicks "Load older" in the TraceFeed.
    """
    if target_date and not _DATE_RE.match(target_date):
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    if not target_date:
        target_date = date.today().isoformat()

    day_dir = _traces_disk_dir(vm) / target_date
    if not day_dir.exists():
        return []

    records: list[dict] = []
    for f in day_dir.glob("*.json"):
        rec = _read_trace_file(f)
        if rec is None:
            continue
        if caller is not None and rec.get("caller", "") != caller:
            continue
        records.append(rec)

    records.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
    records = records[:limit]
    return [
        TraceSummary(
            id=str(r.get("id", "")),
            timestamp=str(r.get("timestamp", "")),
            provider=str(r.get("provider", "")),
            model=str(r.get("model", "")),
            caller=str(r.get("caller", "")),
            duration_ms=int(r.get("duration_ms", 0)),
            error=str(r.get("error", "")),
            response_preview=_preview(str(r.get("response", ""))),
            run_id=str(r.get("run_id", "")),
            step=str(r.get("step", "")),
        )
        for r in records
    ]


class DiskDateList(BaseModel):
    dates: list[str]


@router.get("/disk/dates", response_model=DiskDateList)
def list_trace_dates(
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> DiskDateList:
    """List YYYY-MM-DD directories that have persisted traces (newest first)."""
    return DiskDateList(dates=_list_dates_with_traces(_traces_disk_dir(vm)))


def _run_summary_model(data: dict) -> RunSummary:
    """Coerce a persisted run-summary dict into the response model."""
    return RunSummary(
        run_id=str(data.get("run_id", "")),
        agent=str(data.get("agent", "")),
        status=str(data.get("status", "ok")),
        started=str(data.get("started", "")),
        ended=str(data.get("ended", "")),
        duration_ms=int(data.get("duration_ms", 0)),
        steps=[
            RunStep(
                name=str(s.get("name", "")),
                status=str(s.get("status", "ok")),
                duration_ms=int(s.get("duration_ms", 0)),
                trace_ids=list(s.get("trace_ids", [])),
                error=str(s.get("error", "")),
            )
            for s in data.get("steps", [])
        ],
    )


@router.get("/runs", response_model=list[RunSummary])
def list_runs(limit: int = Query(50, ge=1, le=200)) -> list[RunSummary]:
    """Return recent multi-step agent runs, newest first.

    A run reifies the *shape* of a graph invocation (its ordered steps) so the
    UI can show "Researcher → search → synthesize → save" as one connected run
    rather than a flat list of LLM calls.
    """
    return [_run_summary_model(s) for s in get_trace_store().list_run_summaries(limit=limit)]


@router.get("/runs/{run_id}", response_model=RunDetail)
def get_run_detail(run_id: str) -> RunDetail:
    """Return one run with the full trace record for each step's LLM calls.

    Step trace records are read from the in-memory ring buffer (joined by
    ``run_id``); steps with no LLM call simply have an empty list.
    """
    data = get_trace_store().get_run_summary(run_id)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    summary = _run_summary_model(data)
    by_id = {t.id: t for t in get_trace_store().by_run(run_id)}
    traces: dict[str, list[TraceDetail]] = {}
    for st in summary.steps:
        traces[st.name] = [
            TraceDetail(**by_id[tid].to_dict()) for tid in st.trace_ids if tid in by_id
        ]
    return RunDetail(**summary.model_dump(), traces=traces)


def _find_on_disk(traces_dir: Path, trace_id: str) -> dict | None:
    """Look for a single trace_id by scanning recent date folders (newest first)."""
    if not traces_dir.exists():
        return None
    # The trace id has no embedded date, so we have to scan. Limit to the
    # most recent ~30 days so a deep history doesn't blow the request budget.
    today = date.today()
    for offset in range(0, 30):
        day = (today - timedelta(days=offset)).isoformat()
        candidate = traces_dir / day / f"{trace_id}.json"
        if candidate.exists():
            return _read_trace_file(candidate)
    # Fall back to scanning whatever dates exist on disk.
    for day_name in _list_dates_with_traces(traces_dir):
        try:
            candidate = traces_dir / day_name / f"{trace_id}.json"
        except (OSError, ValueError):
            continue
        if candidate.exists():
            return _read_trace_file(candidate)
    return None


@router.get("/{trace_id}", response_model=TraceDetail)
def get_trace(
    trace_id: str,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> TraceDetail:
    """Return the full record for one trace, falling back to disk on a miss."""
    rec = get_trace_store().get(trace_id)
    if rec is not None:
        return TraceDetail(**rec.to_dict())
    disk_rec = _find_on_disk(_traces_disk_dir(vm), trace_id)
    if disk_rec is not None:
        # Normalise legacy/missing fields so the response model accepts them.
        disk_rec.setdefault("messages", [])
        disk_rec.setdefault("system", "")
        disk_rec.setdefault("error", "")
        return TraceDetail(**disk_rec)
    raise HTTPException(status_code=404, detail=f"Trace {trace_id} not found")
