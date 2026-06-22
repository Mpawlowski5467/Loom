"""Runtime lifecycle helpers shared by the app and vault routes."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING

from core.exceptions import ProviderConfigError, ProviderError
from core.note_index import get_note_index
from core.watcher import start_watcher, stop_watcher

if TYPE_CHECKING:
    import asyncio

    from core.note_index import NoteIndex
    from core.providers.base import BaseProvider
    from core.vault import VaultManager

logger = logging.getLogger(__name__)


def init_vector_index(vault_dir: Path) -> None:
    """Try to initialize the vector indexer and searcher for ``vault_dir``."""
    try:
        from core.graph import load_graph
        from core.providers import get_registry
        from index.indexer import init_indexer
        from index.searcher import init_searcher

        registry = get_registry()
        embed_provider = registry.get_embed_provider()
        loom_dir = vault_dir / ".loom"

        indexer = init_indexer(loom_dir, embed_provider)

        graph = load_graph(loom_dir)
        init_searcher(indexer, embed_provider, graph)

        logger.info("Vector index initialized at %s", loom_dir / "index.db")
    except (ProviderConfigError, ProviderError, OSError):
        logger.warning(
            "Vector index not available; falling back to keyword search.",
            exc_info=True,
        )


def init_agents(vault_dir: Path) -> None:
    """Initialize all agents and the runner for ``vault_dir``."""
    chat = _get_chat_provider()

    agent_inits = [
        ("weaver", "agents.loom.weaver", "init_weaver"),
        ("spider", "agents.loom.spider", "init_spider"),
        ("archivist", "agents.loom.archivist", "init_archivist"),
        ("scribe", "agents.loom.scribe", "init_scribe"),
        ("sentinel", "agents.loom.sentinel", "init_sentinel"),
        ("researcher", "agents.shuttle.researcher", "init_researcher"),
        ("standup", "agents.shuttle.standup", "init_standup"),
    ]

    for name, module_path, fn_name in agent_inits:
        try:
            import importlib

            mod = importlib.import_module(module_path)
            init_fn = getattr(mod, fn_name)
            init_fn(vault_dir, chat)
            logger.info("Agent '%s' initialized", name)
        except Exception:
            logger.warning("Agent '%s' initialization failed", name, exc_info=True)

    try:
        from agents.runner import init_runner

        init_runner(vault_dir)
        logger.info("AgentRunner initialized")
    except Exception:
        logger.warning("AgentRunner initialization failed", exc_info=True)


def reinit_providers_dependent_services(vault_dir: Path) -> None:
    """Rebuild provider-holding services after the provider registry is reset.

    Saving provider settings calls ``reset_registry()``, which ``close()``s the
    cached providers. Agents (``BaseAgent._chat_provider``) and the
    indexer/searcher captured references to those now-closed clients at init
    time, so without this their next LLM/embedding call fails until a restart.
    Re-running the inits rebinds every service to the fresh registry.
    Best-effort: each sub-init logs and swallows its own failure.
    """
    if not vault_dir.exists():
        return
    init_vector_index(vault_dir)
    init_agents(vault_dir)
    logger.info("Provider-dependent services reinitialized for %s", vault_dir)


def init_chat(vault_dir: Path) -> None:
    """Initialize chat persistence for ``vault_dir``."""
    try:
        from agents.chat import init_chat_history

        init_chat_history(vault_dir)
        logger.info("Chat history initialized")
    except Exception:
        logger.warning("Chat history initialization failed", exc_info=True)


def initialize_vault_runtime(
    vault_dir: Path,
    *,
    loop: asyncio.AbstractEventLoop | None = None,
    note_index: NoteIndex | None = None,
) -> None:
    """Initialize all process-local services for a vault directory."""
    if not vault_dir.exists():
        return
    threads_dir = vault_dir / "threads"
    (note_index or get_note_index()).build(threads_dir)
    init_vector_index(vault_dir)
    init_agents(vault_dir)
    init_chat(vault_dir)
    start_watcher(vault_dir, loop=loop)
    _reconcile_index_drift()


def _reconcile_index_drift() -> None:
    """Re-queue notes present in NoteIndex but missing from the vector store.

    Heals "index drift" — notes whose embeddings never landed (e.g. an
    embedding blip) and are invisible to search. Best-effort: a cold or
    unavailable index reports no drift and never blocks startup.
    """
    try:
        from core.watcher import seed_retryable
        from index.indexer import unindexed_note_paths

        drifted = unindexed_note_paths()
        if drifted:
            logger.warning("Index drift detected on startup: %d note(s) — re-queuing", len(drifted))
            seed_retryable(drifted)
    except Exception:
        logger.warning("Index drift reconciliation failed", exc_info=True)


def release_active_handles() -> None:
    """Release watcher, searcher, and indexer handles for the current vault."""
    from index.indexer import reset_indexer
    from index.searcher import reset_searcher

    stop_watcher()
    reset_searcher()
    reset_indexer()


def reload_active_vault_runtime(
    vm: VaultManager,
    *,
    loop: asyncio.AbstractEventLoop | None = None,
    note_index: NoteIndex | None = None,
) -> None:
    """Reload process-local services after the active vault changes."""
    release_active_handles()
    initialize_vault_runtime(vm.active_vault_dir(), loop=loop, note_index=note_index)


def _get_chat_provider() -> BaseProvider | None:
    """Try to get the chat provider, returning None if unavailable."""
    try:
        from core.providers import get_registry

        return get_registry().get_chat_provider()
    except (ProviderConfigError, ProviderError):
        return None
