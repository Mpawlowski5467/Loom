"""FastAPI app entry point."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from starlette.status import HTTP_503_SERVICE_UNAVAILABLE

from api.exception_handlers import register_exception_handlers
from api.health import build_health_report
from api.routers.agents import router as agents_router
from api.routers.agents_registry import router as agents_registry_router
from api.routers.captures import router as captures_router
from api.routers.chat import router as chat_router
from api.routers.config import router as config_router
from api.routers.diagnostics import router as diagnostics_router
from api.routers.graph import router as graph_router
from api.routers.index import router as index_router
from api.routers.notes import router as notes_router
from api.routers.onboarding import router as onboarding_router
from api.routers.providers import router as providers_router
from api.routers.search import router as search_router
from api.routers.settings import router as settings_router
from api.routers.traces import router as traces_router
from api.routers.tree import router as tree_router
from api.routers.vaults import router as vaults_router
from api.runtime import initialize_vault_runtime
from core.config import settings
from core.rate_limit import limiter, rate_limit_exceeded_handler
from core.vault import get_vault_manager
from core.watcher import stop_watcher

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Start file watcher and agents on startup, stop on shutdown."""
    import asyncio

    app.state.started_at = datetime.now(UTC)
    vault_dir = get_vault_manager().active_vault_dir()
    initialize_vault_runtime(vault_dir, loop=asyncio.get_running_loop())
    yield
    stop_watcher()
    try:
        from core.providers import get_registry

        await get_registry().close()
    except Exception:
        logger.warning("Provider registry close failed", exc_info=True)


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

register_exception_handlers(app)

app.include_router(vaults_router)
app.include_router(notes_router)
app.include_router(tree_router)
app.include_router(graph_router)
app.include_router(search_router)
app.include_router(captures_router)
app.include_router(index_router)
app.include_router(agents_router)
app.include_router(agents_registry_router)
app.include_router(chat_router)
app.include_router(settings_router)
app.include_router(config_router)
app.include_router(onboarding_router)
app.include_router(providers_router)
app.include_router(diagnostics_router)
app.include_router(traces_router)


@app.get("/api/health")
async def health_check() -> dict:
    """Structured component health check."""
    return build_health_report()


@app.get("/api/ready")
async def readiness_check() -> JSONResponse:
    """Kubernetes-style readiness probe — 503 when any component is not ready."""
    report = build_health_report()
    status_code = 200 if report["ok"] else HTTP_503_SERVICE_UNAVAILABLE
    return JSONResponse(status_code=status_code, content=report)
