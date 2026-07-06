"""Lifespan init/teardown for the optional Redis cache and Postgres mirror.

Both services are strictly opt-in (``LOOM_REDIS_URL`` / ``LOOM_DATABASE_URL``)
and strictly best-effort: any init failure logs a warning and the app starts
without the service — startup must never crash because an optional backend is
down.
"""

from __future__ import annotations

import contextlib
import logging

from core.cache import get_response_cache
from core.config import settings
from core.traces import get_trace_store

logger = logging.getLogger(__name__)


async def init_optional_services() -> None:
    """Connect the Postgres trace mirror and warm the Redis cache singleton."""
    if settings.database_url:
        from core.trace_pg import PgTraceMirror

        mirror = PgTraceMirror()
        try:
            await mirror.init(settings.database_url)
        except Exception:
            logger.warning(
                "Postgres trace mirror unavailable — continuing without it", exc_info=True
            )
        else:
            mirror.start()
            get_trace_store().set_pg_mirror(mirror)
            logger.info("Postgres trace mirror connected")
    if settings.redis_url:
        # Materialize the singleton so the registry wraps providers with the
        # cache layer from the first call. The Redis connection itself stays
        # lazy — a dead Redis just degrades every cache op to a miss.
        get_response_cache()


async def shutdown_optional_services() -> None:
    """Flush and close the optional services (best-effort)."""
    store = get_trace_store()
    mirror = store.pg_mirror
    if mirror is not None:
        store.set_pg_mirror(None)
        with contextlib.suppress(Exception):
            await mirror.aclose()
    cache = get_response_cache()
    if cache is not None:
        with contextlib.suppress(Exception):
            await cache.aclose()
