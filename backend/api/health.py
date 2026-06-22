"""Component readiness checks for /api/health and /api/ready."""

import logging
from typing import Any

logger = logging.getLogger(__name__)


def _unindexed_count() -> int:
    """Count notes that are in NoteIndex but missing from the vector store.

    Combines startup-detected drift with paths the watcher failed to index
    live, deduped. Best-effort — any error reports 0 so the health check stays
    cheap and never raises.
    """
    try:
        from core.watcher import failed_index_paths
        from index.indexer import unindexed_note_ids

        drift = set(unindexed_note_ids())
        # failed_index_paths() counts live failures; union conceptually, but it
        # returns a count not ids, so take the max to avoid under-reporting
        # when the two sets overlap or diverge.
        return max(len(drift), failed_index_paths())
    except Exception:
        logger.debug("Unindexed count unavailable", exc_info=True)
        return 0


def check_indexer() -> dict[str, Any]:
    """Report indexer readiness.

    ``unindexed`` is a *separate* drift signal — notes present in NoteIndex but
    absent from the vector store. It is intentionally NOT folded into ``ready``:
    ``ready`` must keep meaning "the index has data" because ``/api/ready``
    503-gates on it.
    """
    try:
        from index.indexer import get_indexer

        indexer = get_indexer()
        if indexer is None:
            return {"ready": False, "details": "indexer not initialized", "unindexed": 0}
        unindexed = _unindexed_count()
        if indexer.is_ready:
            return {"ready": True, "details": "index ready", "unindexed": unindexed}
        return {"ready": False, "details": "index has no data", "unindexed": unindexed}
    except Exception as exc:
        logger.warning("Indexer health check failed", exc_info=True)
        return {"ready": False, "details": f"error: {exc}", "unindexed": 0}


def check_agents() -> dict[str, Any]:
    """Report agent runner readiness and agent count."""
    try:
        from agents.runner import get_runner

        runner = get_runner()
        if runner is None:
            return {"ready": False, "count": 0}
        agents = runner.list_agents()
        return {"ready": True, "count": len(agents)}
    except Exception:
        logger.warning("Agent health check failed", exc_info=True)
        return {"ready": False, "count": 0}


def check_watcher() -> dict[str, Any]:
    """Report file watcher readiness."""
    try:
        from core import watcher

        observer = watcher._observer
        ready = observer is not None and observer.is_alive()
        return {"ready": bool(ready)}
    except Exception:
        logger.warning("Watcher health check failed", exc_info=True)
        return {"ready": False}


def check_chat() -> dict[str, Any]:
    """Report chat history readiness."""
    try:
        from agents.chat import get_chat_history

        return {"ready": get_chat_history() is not None}
    except Exception:
        logger.warning("Chat history health check failed", exc_info=True)
        return {"ready": False}


def build_health_report() -> dict[str, Any]:
    """Compose the structured component health report."""
    components = {
        "indexer": check_indexer(),
        "agents": check_agents(),
        "watcher": check_watcher(),
        "chat": check_chat(),
    }
    ok = all(c["ready"] for c in components.values())
    return {"ok": ok, "components": components}
