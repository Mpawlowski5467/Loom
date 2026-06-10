"""Vector index management API routes."""

import asyncio
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from core.rate_limit import WRITE_LIMIT, limiter
from core.vault import VaultManager, get_vault_manager
from index.indexer import get_indexer

router = APIRouter(prefix="/api/index", tags=["index"])

# Serializes reindex/rebuild so two requests (or the scheduled reindex) can't
# race a drop_table/create_table against each other on the same index.
_reindex_lock = asyncio.Lock()


class IndexStatus(BaseModel):
    """Vector index status."""

    ready: bool
    message: str


class IndexStats(BaseModel):
    """Read-only statistics about the vector index contents."""

    ready: bool
    total_chunks: int
    distinct_notes: int
    unindexed_count: int
    avg_chunks_per_note: float
    type_breakdown: dict[str, int]


class ReindexResult(BaseModel):
    """Result of a reindex operation."""

    chunks_indexed: int


@router.get("/status")
def index_status() -> IndexStatus:
    """Check whether the vector index is available."""
    indexer = get_indexer()
    if indexer is None:
        return IndexStatus(
            ready=False, message="Vector indexer not initialized. Configure an embed provider."
        )
    if not indexer.is_ready:
        return IndexStatus(
            ready=False, message="Index exists but contains no data. Run POST /api/index/reindex."
        )
    return IndexStatus(ready=True, message="Vector index is ready.")


@router.get("/stats")
def index_stats() -> IndexStats:
    """Return read-only statistics about the vector index contents.

    Reports chunk/note counts, the drift signal (notes present in NoteIndex but
    absent from vectors), and a per-type chunk breakdown. Returns zeros when no
    index exists yet rather than erroring, so the UI can render a clean
    "not indexed" state.
    """
    from api.health import _unindexed_count

    unindexed = _unindexed_count()
    indexer = get_indexer()
    empty = IndexStats(
        ready=False,
        total_chunks=0,
        distinct_notes=0,
        unindexed_count=unindexed,
        avg_chunks_per_note=0.0,
        type_breakdown={},
    )
    if indexer is None or not indexer.is_ready:
        return empty

    try:
        table = indexer.open_table()
        total = table.count_rows()
        # Project to the two scalar columns we summarize — avoids materializing
        # the (large) vector column. Vault indices are small, so a full scan is
        # cheap and exact.
        arrow = table.to_arrow().select(["note_id", "note_type"])
        note_ids = {nid for nid in arrow.column("note_id").to_pylist() if nid}
        type_breakdown = dict(Counter(arrow.column("note_type").to_pylist()))
    except Exception:  # noqa: BLE001 — same defensive posture as is_ready
        return empty

    return IndexStats(
        ready=True,
        total_chunks=total,
        distinct_notes=len(note_ids),
        unindexed_count=unindexed,
        avg_chunks_per_note=round(total / len(note_ids), 1) if note_ids else 0.0,
        type_breakdown=type_breakdown,
    )


@router.post("/reindex")
@limiter.limit(WRITE_LIMIT)
async def reindex_vault(
    request: Request,  # noqa: ARG001 — required by slowapi
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> ReindexResult:
    """Trigger a full reindex of the vault."""
    return await _do_reindex(vm)


@router.post("/rebuild")
@limiter.limit(WRITE_LIMIT)
async def rebuild_index(
    request: Request,  # noqa: ARG001 — required by slowapi
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> ReindexResult:
    """Rebuild the index from scratch (alias for reindex)."""
    return await _do_reindex(vm)


async def _do_reindex(vm: VaultManager) -> ReindexResult:
    """Shared reindex logic.

    Acquires ``_reindex_lock`` so the drop/create cycle is serialized — a second
    request waits for the first to finish rather than racing the same table.
    """
    indexer = get_indexer()
    if indexer is None:
        raise HTTPException(
            status_code=503,
            detail="Vector indexer not initialized. Configure an embed provider in ~/.loom/config.yaml.",
        )
    # Await the lock (rather than 409) so concurrent reindex requests queue.
    async with _reindex_lock:
        threads_dir = vm.active_threads_dir()
        total = await indexer.reindex_vault(threads_dir)
    return ReindexResult(chunks_indexed=total)
