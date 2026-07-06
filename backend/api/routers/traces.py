"""Traces API — inspect recorded LLM exchanges."""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from api.routers.traces_disk import (
    find_on_disk,
    list_dates_with_traces,
    read_trace_file,
    traces_disk_dir,
)
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
    messages: list[dict[str, Any]]
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


def _summary_from_dict(r: dict[str, Any]) -> TraceSummary:
    """Coerce a persisted trace dict (disk JSON or Postgres row) to a summary."""
    return TraceSummary(
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


@router.get("/disk", response_model=list[TraceSummary])
async def list_traces_disk(
    target_date: str = Query("", alias="date", description="YYYY-MM-DD; defaults to today"),
    caller: str | None = Query(None, description="Filter by caller label"),
    limit: int = Query(100, ge=1, le=1000),
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> list[TraceSummary]:
    """Read persisted traces for one calendar day (Postgres first, then disk).

    Pages back beyond the 500-item in-memory ring buffer. No UI consumer
    since the TraceFeed was folded into the Runs view — kept as an external
    paging API over the persisted history.
    """
    if target_date and not _DATE_RE.match(target_date):
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    if not target_date:
        target_date = date.today().isoformat()

    mirror = get_trace_store().pg_mirror
    if mirror is not None:
        pg_records = await mirror.list_by_date(
            target_date, caller, limit, vault=vm.get_active_vault()
        )
        if pg_records:
            return [_summary_from_dict(r) for r in pg_records]

    def _read_day() -> list[dict[str, Any]]:
        # Blocking dir scan + JSON parse (up to `limit` files) — keep it off
        # the event loop; the old sync-def handler ran in the threadpool too.
        day_dir = traces_disk_dir(vm) / target_date
        if not day_dir.exists():
            return []
        records: list[dict[str, Any]] = []
        for f in day_dir.glob("*.json"):
            rec = read_trace_file(f)
            if rec is None:
                continue
            if caller is not None and rec.get("caller", "") != caller:
                continue
            records.append(rec)
        records.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
        return records[:limit]

    return [_summary_from_dict(r) for r in await asyncio.to_thread(_read_day)]


class DiskDateList(BaseModel):
    dates: list[str]


@router.get("/disk/dates", response_model=DiskDateList)
async def list_trace_dates(
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> DiskDateList:
    """List YYYY-MM-DD dates with persisted traces, newest first (pg, then disk)."""
    mirror = get_trace_store().pg_mirror
    if mirror is not None:
        pg_dates = await mirror.list_dates(vault=vm.get_active_vault())
        if pg_dates:
            return DiskDateList(dates=pg_dates)
    return DiskDateList(dates=await asyncio.to_thread(list_dates_with_traces, traces_disk_dir(vm)))


def _run_summary_model(data: dict[str, Any]) -> RunSummary:
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
async def list_runs(
    limit: int = Query(50, ge=1, le=200),
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> list[RunSummary]:
    """Return recent multi-step agent runs, newest first (Postgres, then disk).

    A run reifies the *shape* of a graph invocation (its ordered steps) so the
    UI can show "Researcher → search → synthesize → save" as one connected run
    rather than a flat list of LLM calls.
    """
    mirror = get_trace_store().pg_mirror
    if mirror is not None:
        pg_runs = await mirror.list_runs(limit, vault=vm.get_active_vault())
        if pg_runs:
            return [_run_summary_model(s) for s in pg_runs]
    return [_run_summary_model(s) for s in get_trace_store().list_run_summaries(limit=limit)]


@router.get("/runs/{run_id}", response_model=RunDetail)
async def get_run_detail(run_id: str) -> RunDetail:
    """Return one run with the full trace record for each step's LLM calls.

    The run summary comes from disk, falling back to the Postgres mirror
    (which outlives disk retention). Step trace records are read from the
    in-memory ring buffer (joined by ``run_id``); traces evicted from the ring
    are filled from the Postgres mirror when one is configured. Steps with no
    LLM call have an empty list.
    """
    store = get_trace_store()
    mirror = store.pg_mirror
    data = store.get_run_summary(run_id)
    if data is None and mirror is not None:
        data = await mirror.get_run(run_id)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    summary = _run_summary_model(data)
    by_id: dict[str, dict[str, Any]] = {t.id: t.to_dict() for t in store.by_run(run_id)}
    if mirror is not None:
        wanted = {tid for st in summary.steps for tid in st.trace_ids}
        if wanted - by_id.keys():
            for rec in await mirror.traces_for_run(run_id):
                by_id.setdefault(str(rec.get("id", "")), rec)
    traces: dict[str, list[TraceDetail]] = {}
    for st in summary.steps:
        traces[st.name] = [TraceDetail(**by_id[tid]) for tid in st.trace_ids if tid in by_id]
    return RunDetail(**summary.model_dump(), traces=traces)


@router.get("/{trace_id}", response_model=TraceDetail)
async def get_trace(
    trace_id: str,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> TraceDetail:
    """Return one full trace: ring buffer, then Postgres, then disk scan."""
    rec = get_trace_store().get(trace_id)
    if rec is not None:
        return TraceDetail(**rec.to_dict())
    mirror = get_trace_store().pg_mirror
    if mirror is not None:
        pg_rec = await mirror.get_trace(trace_id)
        if pg_rec is not None:
            return TraceDetail(**pg_rec)
    # Blocking multi-day dir scan — keep it off the event loop.
    disk_rec = await asyncio.to_thread(find_on_disk, traces_disk_dir(vm), trace_id)
    if disk_rec is not None:
        # Normalise legacy/missing fields so the response model accepts them.
        disk_rec.setdefault("messages", [])
        disk_rec.setdefault("system", "")
        disk_rec.setdefault("error", "")
        return TraceDetail(**disk_rec)
    raise HTTPException(status_code=404, detail=f"Trace {trace_id} not found")
