from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routers.graph import router as graph_router
from api.routers.notes import router as notes_router
from api.routers.search import router as search_router
from api.routers.tree import router as tree_router
from api.routers.vaults import router as vaults_router
from core.config import settings
from core.watcher import start_watcher, stop_watcher


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Start file watcher on startup, stop on shutdown."""
    vault_dir = settings.active_vault_dir
    if vault_dir.exists():
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


@app.get("/api/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok"}
