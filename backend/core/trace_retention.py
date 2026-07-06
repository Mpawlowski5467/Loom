"""Periodic retention sweep for persisted traces (disk mirror + Postgres).

The in-memory ring buffer is self-bounding, but the disk mirror and the
optional Postgres mirror grow forever without this. A single background task
sweeps both once at startup and then daily, keeping the last
``settings.trace_retention_days`` days.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging

from core.traces import get_trace_store, prune_old_traces

logger = logging.getLogger(__name__)

# Daily cadence: retention is date-granular, so sweeping more often is wasted
# work and sweeping less often just delays cleanup by a bounded amount.
_SWEEP_INTERVAL_S = 24 * 60 * 60


class TraceRetention:
    """Background task that prunes old persisted traces on a daily cadence.

    Reads the trace store's current disk dir and Postgres mirror at every
    sweep instead of capturing them at start, so a vault switch or a
    late-connected mirror is picked up without restarting the task.
    """

    def __init__(self, keep_days: int, interval_s: float = _SWEEP_INTERVAL_S) -> None:
        self._keep_days = keep_days
        self._interval_s = interval_s
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        """Start the sweep loop (first sweep runs immediately).

        No-op when retention is disabled (negative ``keep_days``) or the loop
        is already running.
        """
        if self._task is None and self._keep_days >= 0:
            self._task = asyncio.create_task(self._loop(), name="loom-trace-retention")

    async def aclose(self) -> None:
        """Cancel the sweep loop."""
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def _loop(self) -> None:
        while True:
            await self.sweep_once()
            await asyncio.sleep(self._interval_s)

    async def sweep_once(self) -> None:
        """One best-effort sweep of the disk store and the Postgres mirror."""
        store = get_trace_store()
        disk_dir = store.disk_dir
        if disk_dir is not None:
            try:
                removed = await asyncio.to_thread(prune_old_traces, disk_dir, self._keep_days)
                if removed:
                    logger.info("Pruned %d old trace date-dir(s) from %s", removed, disk_dir)
            except OSError:
                logger.warning("Disk trace prune failed", exc_info=True)
        mirror = store.pg_mirror
        if mirror is not None:
            removed_rows = await mirror.prune(self._keep_days)
            if removed_rows:
                logger.info("Pruned %d old trace/run row(s) from Postgres", removed_rows)
