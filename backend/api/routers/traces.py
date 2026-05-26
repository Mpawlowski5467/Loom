"""Traces API — inspect recorded LLM exchanges."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from core.traces import get_trace_store

router = APIRouter(prefix="/api/traces", tags=["traces"])


class TraceSummary(BaseModel):
    id: str
    timestamp: str
    provider: str
    model: str
    caller: str
    duration_ms: int
    error: str
    response_preview: str


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
        )
        for r in items
    ]


@router.get("/{trace_id}", response_model=TraceDetail)
def get_trace(trace_id: str) -> TraceDetail:
    """Return the full record for one trace."""
    rec = get_trace_store().get(trace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"Trace {trace_id} not found")
    d = rec.to_dict()
    return TraceDetail(**d)
