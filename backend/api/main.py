import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded

from api.routers.agents import router as agents_router
from api.routers.captures import router as captures_router
from api.routers.chat import router as chat_router
from api.routers.graph import router as graph_router
from api.routers.index import router as index_router
from api.routers.notes import router as notes_router
from api.routers.search import router as search_router
from api.routers.settings import router as settings_router
from api.routers.tree import router as tree_router
from api.routers.vaults import router as vaults_router
from core.config import settings
from core.exceptions import (
    InvalidVaultNameError,
    LoomError,
    NoteNotFoundError,
    ProviderConfigError,
    ProviderError,
    ReadChainError,
    VaultExistsError,
    VaultNotFoundError,
)
from core.rate_limit import limiter, rate_limit_exceeded_handler
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


def _get_chat_provider():
    """Try to get the chat provider, return None if unavailable."""
    try:
        from core.providers import get_registry

        return get_registry().get_chat_provider()
    except Exception:  # noqa: BLE001
        return None


def _init_agents(vault_dir) -> None:
    """Initialize all agents (Loom + Shuttle) and the runner.

    Non-fatal: each agent is initialized independently. If one fails,
    the others still start.
    """
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
        except Exception:  # noqa: BLE001
            logger.warning("Agent '%s' initialization failed", name, exc_info=True)

    # Initialize the runner
    try:
        from agents.runner import init_runner

        init_runner(vault_dir)
        logger.info("AgentRunner initialized")
    except Exception:  # noqa: BLE001
        logger.warning("AgentRunner initialization failed", exc_info=True)


def _init_chat(vault_dir) -> None:
    """Initialize the chat persistence layer."""
    try:
        from agents.chat import init_chat_history

        init_chat_history(vault_dir)
        logger.info("Chat history initialized")
    except Exception:  # noqa: BLE001
        logger.warning("Chat history initialization failed", exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Start file watcher and agents on startup, stop on shutdown."""
    import asyncio

    vault_dir = settings.active_vault_dir
    if vault_dir.exists():
        _init_vector_index(vault_dir)
        _init_agents(vault_dir)
        _init_chat(vault_dir)
        loop = asyncio.get_running_loop()
        start_watcher(vault_dir, loop=loop)
    yield
    stop_watcher()
    # Clean up provider resources (e.g. httpx clients)
    try:
        from core.providers import get_registry

        await get_registry().close()
    except Exception:  # noqa: BLE001
        pass


app = FastAPI(title="Loom", version="0.1.0", lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -- Global exception handlers ------------------------------------------------


@app.exception_handler(VaultNotFoundError)
async def vault_not_found_handler(request: Request, exc: VaultNotFoundError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"error": str(exc), "type": "VaultNotFoundError"})


@app.exception_handler(NoteNotFoundError)
async def note_not_found_handler(request: Request, exc: NoteNotFoundError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"error": str(exc), "type": "NoteNotFoundError"})


@app.exception_handler(VaultExistsError)
async def vault_exists_handler(request: Request, exc: VaultExistsError) -> JSONResponse:
    return JSONResponse(status_code=409, content={"error": str(exc), "type": "VaultExistsError"})


@app.exception_handler(InvalidVaultNameError)
async def invalid_vault_name_handler(request: Request, exc: InvalidVaultNameError) -> JSONResponse:
    return JSONResponse(
        status_code=422, content={"error": str(exc), "type": "InvalidVaultNameError"}
    )


@app.exception_handler(ProviderConfigError)
async def provider_config_handler(request: Request, exc: ProviderConfigError) -> JSONResponse:
    return JSONResponse(status_code=503, content={"error": str(exc), "type": "ProviderConfigError"})


@app.exception_handler(ReadChainError)
async def read_chain_handler(request: Request, exc: ReadChainError) -> JSONResponse:
    return JSONResponse(status_code=403, content={"error": str(exc), "type": "ReadChainError"})


@app.exception_handler(ProviderError)
async def provider_error_handler(request: Request, exc: ProviderError) -> JSONResponse:
    return JSONResponse(status_code=502, content={"error": str(exc), "type": "ProviderError"})


@app.exception_handler(LoomError)
async def loom_error_handler(request: Request, exc: LoomError) -> JSONResponse:
    return JSONResponse(
        status_code=500, content={"error": str(exc), "type": exc.__class__.__name__}
    )


app.include_router(vaults_router)
app.include_router(notes_router)
app.include_router(tree_router)
app.include_router(graph_router)
app.include_router(search_router)
app.include_router(captures_router)
app.include_router(index_router)
app.include_router(agents_router)
app.include_router(chat_router)
app.include_router(settings_router)


@app.get("/api/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok"}
