# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────
# Stage 1 — build the frontend to static files.
# VITE_API_BASE="" makes the SPA call its API at same-origin (relative /api),
# so the single container works regardless of the host/port it's reached on.
# ─────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS frontend
WORKDIR /app/frontend

# Install deps first (cached unless package manifests change).
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# Vite 8 bundles with Rolldown, whose native binding is platform-specific. The
# committed package-lock.json was resolved on macOS, so it only carries the
# darwin binding — `npm ci` has no Linux binding to install (npm cross-platform
# optional-dep gap, npm/cli#4828). Install the matching Linux binding explicitly
# at the same version as the rest of rolldown so the build can run in-container.
RUN ROLLDOWN_VERSION="$(node -p "require('./node_modules/rolldown/package.json').version")" \
    && ARCH="$(node -p "process.arch === 'arm64' ? 'arm64' : 'x64'")" \
    && npm install --no-save --no-package-lock \
        "@rolldown/binding-linux-${ARCH}-gnu@${ROLLDOWN_VERSION}"

# Build.
COPY frontend/ ./
ENV VITE_API_BASE=""
RUN npm run build   # → /app/frontend/dist

# ─────────────────────────────────────────────────────────────────────────
# Stage 2 — Python runtime that serves both the API and the built SPA.
# python:3.12-slim (Debian) ships manylinux-compatible wheels for lancedb,
# pyarrow, and tiktoken — no compiler needed.
# ─────────────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime
WORKDIR /app/backend

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    # Vault data lives here; docker-compose mounts a named volume at /data.
    LOOM_HOME=/data

# Install the backend. Copy the package config first for layer caching.
COPY backend/pyproject.toml ./
COPY backend/ ./
RUN pip install --upgrade pip && pip install .

# Drop the built SPA where the backend looks for it (api/main.py → ../static).
COPY --from=frontend /app/frontend/dist ./static

# Run as a non-root user; ensure it owns the data dir.
RUN useradd --create-home --uid 1000 loom \
    && mkdir -p /data \
    && chown -R loom:loom /data /app
USER loom

EXPOSE 8000

# Container-level healthcheck hits the readiness probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/api/health').status==200 else 1)" || exit 1

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
