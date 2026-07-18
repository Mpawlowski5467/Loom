"""FastAPI app entry point."""

from __future__ import annotations

import hmac
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import RequestResponseEndpoint
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.status import HTTP_503_SERVICE_UNAVAILABLE

from api.exception_handlers import register_exception_handlers
from api.health import build_health_report
from api.optional_services import init_optional_services, shutdown_optional_services
from api.routers.agent_models import router as agent_models_router
from api.routers.agents import router as agents_router
from api.routers.agents_registry import router as agents_registry_router
from api.routers.archive import router as archive_router
from api.routers.automations import router as automations_router
from api.routers.captures import router as captures_router
from api.routers.chat import router as chat_router
from api.routers.config import router as config_router
from api.routers.diagnostics import router as diagnostics_router
from api.routers.events import router as events_router
from api.routers.graph import router as graph_router
from api.routers.hardware import router as hardware_router
from api.routers.index import router as index_router
from api.routers.notes import router as notes_router
from api.routers.onboarding import router as onboarding_router
from api.routers.provider_auth import router as provider_auth_router
from api.routers.providers import router as providers_router
from api.routers.search import router as search_router
from api.routers.settings import router as settings_router
from api.routers.traces import router as traces_router
from api.routers.tree import router as tree_router
from api.routers.vaults import (
    recover_interrupted_vault_imports,
)
from api.routers.vaults import (
    router as vaults_router,
)
from api.runtime import initialize_vault_runtime
from core.config import GlobalConfig, settings
from core.rate_limit import limiter, rate_limit_exceeded_handler
from core.vault import get_vault_manager
from core.watcher import stop_watcher

logger = logging.getLogger(__name__)

# Localhost-only hosts the API answers to by default. ``testserver`` is the
# Host header Starlette's TestClient sends, so it must stay in the default set
# or every test would 400 on the TrustedHostMiddleware check.
_DEFAULT_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "*.localhost", "testserver"]

# Security headers applied to every response. Kept deliberately minimal: no CSP,
# which would risk breaking the SPA's inline/hashed bundles.
_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
}

# /api paths the optional token gate never challenges, so liveness/readiness
# probes (and the Docker smoke test) keep working with no credentials.
_TOKEN_GATE_OPEN_PATHS = frozenset(
    {
        "/api/health",
        "/api/ready",
        # OpenRouter redirects the browser here and cannot attach Loom's
        # optional API-token header. The callback remains protected by a
        # short-lived, one-time PKCE flow state.
        "/api/providers/openrouter/oauth/callback",
    }
)


def _extract_bearer_token(request: Request) -> str | None:
    """Pull the caller's token from the Authorization or X-Loom-Token header.

    Accepts ``Authorization: Bearer <token>`` (case-insensitive scheme) or the
    ``X-Loom-Token: <token>`` shorthand. Returns ``None`` when neither carries a
    non-empty value.
    """
    authorization = request.headers.get("Authorization", "")
    scheme, _, credential = authorization.partition(" ")
    if scheme.lower() == "bearer" and credential.strip():
        return credential.strip()
    shorthand = request.headers.get("X-Loom-Token", "").strip()
    return shorthand or None


def _allowed_hosts() -> list[str]:
    """Resolve the allowed Host headers for TrustedHostMiddleware.

    Defaults to localhost-style hosts plus ``testserver`` (TestClient). A user
    exposing the port can override via the ``LOOM_ALLOWED_HOSTS`` env var, a
    comma-separated list (e.g. ``"loom.example.com,localhost"``).
    """
    raw = os.environ.get("LOOM_ALLOWED_HOSTS")
    if not raw:
        return list(_DEFAULT_ALLOWED_HOSTS)
    hosts = [h.strip() for h in raw.split(",") if h.strip()]
    return hosts or list(_DEFAULT_ALLOWED_HOSTS)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Start file watcher and agents on startup, stop on shutdown."""
    import asyncio

    from core.trace_retention import TraceRetention
    from core.traces import get_trace_store

    app.state.started_at = datetime.now(UTC)
    vm = get_vault_manager()
    # Resolve an interrupted overwrite before the watcher, index, or workers
    # open handles against a missing or half-promoted active vault.
    recover_interrupted_vault_imports(vm._settings.vaults_dir)
    vault_dir = vm.active_vault_dir()
    initialize_vault_runtime(vault_dir, loop=asyncio.get_running_loop())
    # The durable Inbox worker is active-vault-only because Loom agents are
    # process-global. Interrupted rows remain recoverable if startup cannot
    # initialize the worker; queue availability must not take down the API.
    try:
        from core.capture_jobs import get_capture_job_service

        get_capture_job_service().enable(vault_dir)
        if vault_dir.exists() and (vault_dir / "vault.yaml").exists():
            await get_capture_job_service().activate(
                vault_dir, GlobalConfig.load(vm.config_path()).capture_processing
            )
    except Exception:
        logger.warning("Capture job worker initialization failed", exc_info=True)
    try:
        from core.standup_scheduler import get_standup_scheduler

        await get_standup_scheduler().start()
    except Exception:
        logger.warning("Standup scheduler initialization failed", exc_info=True)
    # Mirror traces to disk so they survive restarts and we can page back
    # beyond the 500-item in-memory ring buffer. The vault label tags rows in
    # the (install-wide) Postgres mirror so its reads scope per vault too.
    get_trace_store().set_disk_dir(vm.active_loom_dir() / "traces")
    get_trace_store().set_vault_label(vm.get_active_vault())
    # Optional Redis cache + Postgres trace mirror — no-ops unless configured,
    # and a failed init only logs (startup must not depend on either service).
    await init_optional_services()
    # Daily retention sweep so persisted traces (disk + Postgres) don't grow
    # unboundedly. Started after the optional services so the first sweep can
    # already see a connected Postgres mirror.
    retention = TraceRetention(keep_days=settings.trace_retention_days)
    retention.start()
    yield
    try:
        from core.capture_jobs import get_capture_job_service

        await get_capture_job_service().aclose()
    except Exception:
        logger.warning("Capture job worker shutdown failed", exc_info=True)
    try:
        from core.standup_scheduler import get_standup_scheduler

        await get_standup_scheduler().aclose()
    except Exception:
        logger.warning("Standup scheduler shutdown failed", exc_info=True)
    stop_watcher()
    await retention.aclose()
    await shutdown_optional_services()
    try:
        from core.providers import get_registry

        await get_registry().close()
    except Exception:
        logger.warning("Provider registry close failed", exc_info=True)


app = FastAPI(title="Loom", version="1.0.0", lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# DNS-rebinding defense: reject requests whose Host header is not a known
# localhost-style host (or a user-configured one). Without this, a malicious
# page could rebind DNS and reach the unauthenticated localhost API.
app.add_middleware(TrustedHostMiddleware, allowed_hosts=_allowed_hosts())


@app.middleware("http")
async def security_headers(request: Request, call_next: RequestResponseEndpoint) -> Response:
    """Attach minimal hardening headers to every response."""
    response = await call_next(request)
    for header, value in _SECURITY_HEADERS.items():
        response.headers.setdefault(header, value)
    return response


@app.middleware("http")
async def redact_provider_oauth_query(
    request: Request, call_next: RequestResponseEndpoint
) -> Response:
    """Keep one-time provider authorization codes out of Uvicorn access logs.

    Uvicorn builds its access-log request target from the mutable ASGI scope
    when the response starts. The callback must receive its query first, so we
    clear it only after the route has produced a response but before the outer
    server writes/logs that response.
    """
    response = await call_next(request)
    if request.url.path == "/api/providers/openrouter/oauth/callback":
        request.scope["query_string"] = b""
    return response


@app.middleware("http")
async def api_token_gate(request: Request, call_next: RequestResponseEndpoint) -> Response:
    """Optional shared-token gate for the API (defense-in-depth, not auth).

    Inert by default: when ``LOOM_API_TOKEN`` is unset/empty the request passes
    straight through, preserving the unauthenticated localhost posture. When a
    token is configured, every ``/api`` request other than the health/readiness
    probes must present a matching token (``Authorization: Bearer <token>`` or
    ``X-Loom-Token: <token>``); a miss returns a 401 in the standard error shape.

    CORS preflight (``OPTIONS``) is never challenged: browsers do not attach
    Authorization to preflight requests, so gating them would break the
    cross-origin dev SPA (Vite on :5173) whenever a token is set. The preflight
    carries no credentials and only asks CORSMiddleware (inner middleware) for
    permission metadata; the actual request is still gated when it arrives.

    This is a speed bump for users who expose the port, not access control for
    untrusted networks — pair it with a reverse proxy that adds real auth + TLS.
    """
    required = settings.api_token
    path = request.url.path
    if (
        required
        and request.method != "OPTIONS"
        and path.startswith("/api/")
        and path not in _TOKEN_GATE_OPEN_PATHS
    ):
        provided = _extract_bearer_token(request)
        # hmac.compare_digest is constant-time so a wrong token can't leak the
        # secret's content via timing. Bytes (not str) so non-ASCII tokens never
        # raise. A wholly absent token short-circuits — nothing secret to leak.
        if provided is None or not hmac.compare_digest(
            provided.encode("utf-8"), required.encode("utf-8")
        ):
            return JSONResponse(
                status_code=401,
                content={"error": "Missing or invalid API token", "type": "Unauthorized"},
                headers={"WWW-Authenticate": "Bearer"},
            )
    return await call_next(request)


register_exception_handlers(app)

app.include_router(vaults_router)
app.include_router(notes_router)
app.include_router(archive_router)
app.include_router(automations_router)
app.include_router(tree_router)
app.include_router(graph_router)
app.include_router(search_router)
app.include_router(captures_router)
app.include_router(index_router)
app.include_router(agents_router)
app.include_router(agents_registry_router)
app.include_router(agent_models_router)
app.include_router(chat_router)
app.include_router(hardware_router)
app.include_router(settings_router)
app.include_router(config_router)
app.include_router(onboarding_router)
app.include_router(provider_auth_router)
app.include_router(providers_router)
app.include_router(diagnostics_router)
app.include_router(traces_router)
app.include_router(events_router)


@app.get("/api/health")
async def health_check() -> dict[str, Any]:
    """Structured component health check."""
    return build_health_report()


@app.get("/api/ready")
async def readiness_check() -> JSONResponse:
    """Kubernetes-style readiness probe — 503 when any component is not ready."""
    report = build_health_report()
    status_code = 200 if report["ok"] else HTTP_503_SERVICE_UNAVAILABLE
    return JSONResponse(status_code=status_code, content=report)


def _frontend_dist() -> Path | None:
    """Locate the built frontend, if any. Returns None in dev (unbuilt)."""
    # Docker copies the built SPA next to the backend at ``static/``; allow an
    # explicit override via LOOM_STATIC_DIR. Absent → API-only (local dev).
    candidates = [
        os.environ.get("LOOM_STATIC_DIR"),
        str(Path(__file__).resolve().parent.parent / "static"),
    ]
    for candidate in candidates:
        if candidate and (Path(candidate) / "index.html").is_file():
            return Path(candidate)
    return None


def _mount_frontend(application: FastAPI) -> None:
    """Serve the built SPA so a single container hosts both UI and API.

    No-op when no build is present (the dev workflow runs Vite separately).
    The catch-all is registered LAST and never shadows ``/api`` routes.
    """
    dist = _frontend_dist()
    if dist is None:
        logger.info("No frontend build found — running API-only.")
        return

    # Hashed asset bundles live under assets/; serve them directly.
    assets = dist / "assets"
    if assets.is_dir():
        application.mount("/assets", StaticFiles(directory=assets), name="assets")

    index_file = dist / "index.html"

    @application.get("/{full_path:path}")
    async def spa_fallback(full_path: str) -> FileResponse:
        """Return a real static file if it exists, else index.html (SPA routing)."""
        if full_path.startswith("api/"):
            # API routes are owned by the routers above; a miss here is a 404,
            # not the SPA shell (so bad API calls fail loudly).
            raise HTTPException(status_code=404, detail="Not found")
        candidate = (dist / full_path).resolve()
        # Guard against path traversal escaping the dist directory.
        if full_path and candidate.is_file() and str(candidate).startswith(str(dist.resolve())):
            return FileResponse(candidate)
        return FileResponse(index_file)

    logger.info("Serving frontend from %s", dist)


_mount_frontend(app)
