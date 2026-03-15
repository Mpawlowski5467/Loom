import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routers.captures import router as captures_router
from api.routers.graph import router as graph_router
from api.routers.index import router as index_router
from api.routers.notes import router as notes_router
from api.routers.search import router as search_router
from api.routers.tree import router as tree_router
from api.routers.vaults import router as vaults_router
from core.config import settings
from core.watcher import start_watcher, stop_watcher

logger = logging.getLogger(__name__)


def _init_vector_index(vault_dir) -> None:
    """Try to initialize the vector indexer and searcher.

    Non-fatal: if the embed provider is not configured, the app still
    starts and falls back to keyword search.
    """
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
    except Exception:  # noqa: BLE001
        logger.warning(
            "Vector index not available — falling back to keyword search. "
            "Configure an embed provider in ~/.loom/config.yaml to enable semantic search.",
            exc_info=True,
        )


def _init_weaver(vault_dir) -> None:
    """Try to initialize the Weaver agent.

    Non-fatal: if no chat provider is configured, Weaver runs without LLM
    (heuristic classification, raw content passthrough).
    """
    try:
        from agents.loom.weaver import init_weaver
        from core.providers import get_registry

        try:
            registry = get_registry()
            chat_provider = registry.get_chat_provider()
        except Exception:  # noqa: BLE001
            chat_provider = None

        init_weaver(vault_dir, chat_provider)
        logger.info("Weaver agent initialized (chat_provider=%s)", chat_provider is not None)
    except Exception:  # noqa: BLE001
        logger.warning("Weaver agent initialization failed", exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Start file watcher and agents on startup, stop on shutdown."""
    vault_dir = settings.active_vault_dir
    if vault_dir.exists():
        _init_vector_index(vault_dir)
        _init_weaver(vault_dir)
        start_watcher(vault_dir)
    yield
    stop_watcher()


app = FastAPI(title="Loom", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(vaults_router)
app.include_router(notes_router)
app.include_router(tree_router)
app.include_router(graph_router)
app.include_router(search_router)
app.include_router(captures_router)
app.include_router(index_router)


@app.get("/api/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok"}
