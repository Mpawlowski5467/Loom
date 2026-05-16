"""Component readiness checks for /api/health and /api/ready."""

import logging

logger = logging.getLogger(__name__)


def check_indexer() -> dict:
    """Report indexer readiness."""
    try:
        from index.indexer import get_indexer

        indexer = get_indexer()
        if indexer is None:
            return {"ready": False, "details": "indexer not initialized"}
        if indexer.is_ready:
            return {"ready": True, "details": "index ready"}
        return {"ready": False, "details": "index has no data"}
    except Exception as exc:
        logger.warning("Indexer health check failed", exc_info=True)
        return {"ready": False, "details": f"error: {exc}"}


def check_agents() -> dict:
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


def check_watcher() -> dict:
    """Report file watcher readiness."""
    try:
        from core import watcher

        observer = watcher._observer
        ready = observer is not None and observer.is_alive()
        return {"ready": bool(ready)}
    except Exception:
        logger.warning("Watcher health check failed", exc_info=True)
        return {"ready": False}


def check_chat() -> dict:
    """Report chat history readiness."""
    try:
        from agents.chat import get_chat_history

        return {"ready": get_chat_history() is not None}
    except Exception:
        logger.warning("Chat history health check failed", exc_info=True)
        return {"ready": False}


def build_health_report() -> dict:
    """Compose the structured component health report."""
    components = {
        "indexer": check_indexer(),
        "agents": check_agents(),
        "watcher": check_watcher(),
        "chat": check_chat(),
    }
    ok = all(c["ready"] for c in components.values())
    return {"ok": ok, "components": components}
