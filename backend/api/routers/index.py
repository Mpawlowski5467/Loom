"""Vector index management API routes."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.config import settings
from index.indexer import get_indexer

router = APIRouter(prefix="/api/index", tags=["index"])


class IndexStatus(BaseModel):
    """Vector index status."""

    ready: bool
    message: str


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


@router.post("/reindex")
async def reindex_vault() -> ReindexResult:
    """Trigger a full reindex of the vault."""
    indexer = get_indexer()
    if indexer is None:
        raise HTTPException(
            status_code=503,
            detail="Vector indexer not initialized. Configure an embed provider in ~/.loom/config.yaml.",
        )
    threads_dir = settings.active_vault_dir / "threads"
    total = await indexer.reindex_vault(threads_dir)
    return ReindexResult(chunks_indexed=total)
