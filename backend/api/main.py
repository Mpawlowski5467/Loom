"""FastAPI app entry point."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.routes import (
    config_routes,
    onboarding_routes,
    providers_routes,
    vault_routes,
)
from core.exceptions import LoomError

# TODO: extend allowed origins when packaging as a Tauri/Electron app.
ALLOWED_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
)

app = FastAPI(title="Loom", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.exception_handler(LoomError)
async def loom_error_handler(_: Request, exc: LoomError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.__class__.__name__, "message": str(exc)},
    )


@app.get("/api/health")
async def health() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok"}


app.include_router(config_routes.router)
app.include_router(providers_routes.router)
app.include_router(vault_routes.router)
app.include_router(onboarding_routes.router)
