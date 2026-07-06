"""Optional Postgres mirror for LLM traces and run summaries.

Strictly additive to :class:`core.traces.TraceStore` — the in-memory ring and
disk mirror keep working exactly as before. When ``LOOM_DATABASE_URL`` is set,
the store also enqueues every trace/run summary here; a single background task
drains the queue into two tables (``loom_traces``, ``loom_runs``). The queue
is bounded and drops the OLDEST entry on overflow so a slow/dead database can
never block or bloat the hot call path.

Reads (used by the traces router as a durable, restart-surviving source) are
all best-effort: any failure returns an empty result so callers fall back to
today's disk behavior.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

logger = logging.getLogger(__name__)

_QUEUE_MAX = 1000

_CREATE_TRACES_SQL = """
CREATE TABLE IF NOT EXISTS loom_traces (
    id text PRIMARY KEY,
    ts timestamptz,
    provider text,
    model text,
    caller text,
    run_id text,
    step text,
    system text,
    messages jsonb,
    response text,
    duration_ms int,
    error text,
    vault text
)
"""

_CREATE_RUNS_SQL = """
CREATE TABLE IF NOT EXISTS loom_runs (
    id text PRIMARY KEY,
    started timestamptz,
    summary jsonb,
    vault text
)
"""

# The tables are shared across vaults (one database per install), so rows are
# tagged with the vault they came from and the list-style reads filter on it —
# matching the per-vault scoping of the disk mirror. These ALTERs migrate
# tables created before the column existed; their legacy NULL-vault rows keep
# showing everywhere rather than disappearing.
_MIGRATE_SQL = (
    "ALTER TABLE loom_traces ADD COLUMN IF NOT EXISTS vault text",
    "ALTER TABLE loom_runs ADD COLUMN IF NOT EXISTS vault text",
)

_INSERT_TRACE_SQL = """
INSERT INTO loom_traces
    (id, ts, provider, model, caller, run_id, step, system, messages,
     response, duration_ms, error, vault)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13)
ON CONFLICT (id) DO NOTHING
"""

_INSERT_RUN_SQL = """
INSERT INTO loom_runs (id, started, summary, vault)
VALUES ($1, $2, $3::jsonb, $4)
ON CONFLICT (id) DO UPDATE
    SET started = EXCLUDED.started, summary = EXCLUDED.summary, vault = EXCLUDED.vault
"""

_TRACE_COLUMNS = (
    "id, ts, provider, model, caller, run_id, step, system, messages, response, duration_ms, error"
)


def _parse_ts(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return datetime.now().astimezone()


def _row_to_run(row: Any) -> dict[str, Any] | None:
    """Map a loom_runs row back to the run-summary dict shape, or None if bad."""
    summary = row["summary"]
    if isinstance(summary, str):
        with contextlib.suppress(json.JSONDecodeError):
            summary = json.loads(summary)
    return summary if isinstance(summary, dict) else None


def _deleted_count(status: Any) -> int:
    """Parse asyncpg's ``"DELETE <n>"`` command status; 0 for anything else."""
    if isinstance(status, str):
        _, _, count = status.rpartition(" ")
        if count.isdigit():
            return int(count)
    return 0


def _row_to_trace(row: Any) -> dict[str, Any]:
    """Map a loom_traces row back to the TraceRecord.to_dict() shape."""
    messages = row["messages"]
    if isinstance(messages, str):
        with contextlib.suppress(json.JSONDecodeError):
            messages = json.loads(messages)
    ts = row["ts"]
    return {
        "id": row["id"],
        "timestamp": ts.isoformat() if isinstance(ts, datetime) else str(ts),
        "provider": row["provider"] or "",
        "model": row["model"] or "",
        "caller": row["caller"] or "",
        "run_id": row["run_id"] or "",
        "step": row["step"] or "",
        "system": row["system"] or "",
        "messages": messages if isinstance(messages, list) else [],
        "response": row["response"] or "",
        "duration_ms": int(row["duration_ms"] or 0),
        "error": row["error"] or "",
    }


class PgTraceMirror:
    """Durable trace/run store: bounded write queue + asyncpg pool."""

    def __init__(self) -> None:
        self._pool: Any = None
        self._queue: asyncio.Queue[tuple[str, dict[str, Any]]] = asyncio.Queue(maxsize=_QUEUE_MAX)
        self._dropped = 0
        self._task: asyncio.Task[None] | None = None
        self._write_warned = False

    @property
    def connected(self) -> bool:
        """Whether init() succeeded and the pool is open."""
        return self._pool is not None

    @property
    def dropped(self) -> int:
        """Number of queue entries discarded because the queue was full."""
        return self._dropped

    async def init(self, database_url: str) -> None:
        """Open the pool and create the tables. Raises on failure.

        ``timeout`` bounds each connection attempt: without it, a
        configured-but-unreachable host (packets dropped, not refused) would
        hold app startup for asyncpg's 60s default.
        """
        import asyncpg

        self._pool = await asyncpg.create_pool(database_url, min_size=1, max_size=4, timeout=5)
        async with self._pool.acquire() as conn:
            await conn.execute(_CREATE_TRACES_SQL)
            await conn.execute(_CREATE_RUNS_SQL)
            for sql in _MIGRATE_SQL:
                await conn.execute(sql)

    def start(self) -> None:
        """Start the single background drain task (call after init())."""
        if self._task is None:
            self._task = asyncio.create_task(self._drain(), name="loom-pg-trace-drain")

    async def aclose(self) -> None:
        """Flush what the drain task can within a grace period, then close."""
        if self._task is not None:
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._queue.join(), timeout=5.0)
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    # Write path ---------------------------------------------------------

    def enqueue_trace(self, record: dict[str, Any]) -> None:
        """Queue one TraceRecord.to_dict() payload; never blocks."""
        self._enqueue(("trace", record))

    def enqueue_run(self, summary: dict[str, Any]) -> None:
        """Queue one run-summary payload; never blocks."""
        self._enqueue(("run", summary))

    def _enqueue(self, item: tuple[str, dict[str, Any]]) -> None:
        try:
            self._queue.put_nowait(item)
        except asyncio.QueueFull:
            # Drop the oldest entry to make room — recent traces matter more.
            with contextlib.suppress(asyncio.QueueEmpty):
                self._queue.get_nowait()
                self._queue.task_done()
                self._dropped += 1
            with contextlib.suppress(asyncio.QueueFull):
                self._queue.put_nowait(item)

    async def _drain(self) -> None:
        while True:
            kind, payload = await self._queue.get()
            try:
                await self._write(kind, payload)
            except Exception:
                if not self._write_warned:
                    self._write_warned = True
                    logger.warning("Postgres trace write failed; dropping", exc_info=True)
                else:
                    logger.debug("Postgres trace write failed", exc_info=True)
            finally:
                self._queue.task_done()

    async def _write(self, kind: str, payload: dict[str, Any]) -> None:
        if self._pool is None:
            return
        vault = str(payload.get("vault", "")) or None
        if kind == "trace":
            await self._pool.execute(
                _INSERT_TRACE_SQL,
                str(payload.get("id", "")),
                _parse_ts(str(payload.get("timestamp", ""))),
                str(payload.get("provider", "")),
                str(payload.get("model", "")),
                str(payload.get("caller", "")),
                str(payload.get("run_id", "")),
                str(payload.get("step", "")),
                str(payload.get("system", "")),
                json.dumps(payload.get("messages", [])),
                str(payload.get("response", "")),
                int(payload.get("duration_ms", 0)),
                str(payload.get("error", "")),
                vault,
            )
        else:
            await self._pool.execute(
                _INSERT_RUN_SQL,
                str(payload.get("run_id", "")),
                _parse_ts(str(payload.get("started", ""))),
                json.dumps(payload),
                vault,
            )

    async def prune(self, keep_days: int) -> int:
        """Delete traces and run summaries dated more than ``keep_days`` days ago.

        Mirrors :func:`core.traces.prune_old_traces` semantics: today (UTC)
        counts as day 0, rows on the cutoff day survive, and a negative
        ``keep_days`` disables pruning. Best-effort — a failure logs and the
        sweep reports what it managed to remove, so retention never raises
        into its scheduler.

        Returns:
            The total number of rows removed across both tables.
        """
        if self._pool is None or keep_days < 0:
            return 0
        cutoff = datetime.combine(
            datetime.now(UTC).date() - timedelta(days=keep_days), time.min, tzinfo=UTC
        )
        removed = 0
        try:
            for sql in (
                "DELETE FROM loom_traces WHERE ts < $1",
                "DELETE FROM loom_runs WHERE started < $1",
            ):
                removed += _deleted_count(await self._pool.execute(sql, cutoff))
        except Exception:
            logger.warning("Postgres trace prune failed", exc_info=True)
        return removed

    # Read path (best-effort; empty results mean "fall back to disk") -----

    async def list_by_date(
        self, target_date: str, caller: str | None, limit: int, vault: str | None = None
    ) -> list[dict[str, Any]]:
        """Return traces for one YYYY-MM-DD day, newest first.

        ``vault`` scopes to that vault's rows (legacy NULL-vault rows always
        included); None returns every vault's rows.
        """
        try:
            day = date.fromisoformat(target_date)
        except ValueError:
            return []
        conds = ["ts::date = $1"]
        args: list[Any] = [day]
        if vault is not None:
            args.append(vault)
            conds.append(f"(vault = ${len(args)} OR vault IS NULL)")
        if caller is not None:
            args.append(caller)
            conds.append(f"caller = ${len(args)}")
        args.append(limit)
        sql = (
            f"SELECT {_TRACE_COLUMNS} FROM loom_traces WHERE {' AND '.join(conds)}"
            f" ORDER BY ts DESC LIMIT ${len(args)}"
        )
        rows = await self._fetch(sql, *args)
        return [_row_to_trace(r) for r in rows]

    async def list_dates(self, vault: str | None = None) -> list[str]:
        """Return YYYY-MM-DD dates that have traces, newest first."""
        if vault is not None:
            rows = await self._fetch(
                "SELECT DISTINCT ts::date AS day FROM loom_traces"
                " WHERE vault = $1 OR vault IS NULL ORDER BY day DESC",
                vault,
            )
        else:
            rows = await self._fetch(
                "SELECT DISTINCT ts::date AS day FROM loom_traces ORDER BY day DESC"
            )
        return [row["day"].isoformat() for row in rows if row["day"] is not None]

    async def get_trace(self, trace_id: str) -> dict[str, Any] | None:
        """Return one trace by id, or None."""
        rows = await self._fetch(
            f"SELECT {_TRACE_COLUMNS} FROM loom_traces WHERE id = $1",
            trace_id,
        )
        return _row_to_trace(rows[0]) if rows else None

    async def traces_for_run(self, run_id: str) -> list[dict[str, Any]]:
        """Return all traces recorded under one run id, oldest first."""
        rows = await self._fetch(
            f"SELECT {_TRACE_COLUMNS} FROM loom_traces WHERE run_id = $1 ORDER BY ts",
            run_id,
        )
        return [_row_to_trace(r) for r in rows]

    async def list_runs(self, limit: int, vault: str | None = None) -> list[dict[str, Any]]:
        """Return recent run summaries, newest first (vault-scoped when given)."""
        if vault is not None:
            rows = await self._fetch(
                "SELECT summary FROM loom_runs WHERE vault = $1 OR vault IS NULL"
                " ORDER BY started DESC LIMIT $2",
                vault,
                limit,
            )
        else:
            rows = await self._fetch(
                "SELECT summary FROM loom_runs ORDER BY started DESC LIMIT $1", limit
            )
        return [s for s in (_row_to_run(r) for r in rows) if s is not None]

    async def get_run(self, run_id: str) -> dict[str, Any] | None:
        """Return one run summary by id, or None."""
        rows = await self._fetch("SELECT summary FROM loom_runs WHERE id = $1", run_id)
        return _row_to_run(rows[0]) if rows else None

    async def _fetch(self, sql: str, *args: Any) -> list[Any]:
        if self._pool is None:
            return []
        try:
            result: list[Any] = await self._pool.fetch(sql, *args)
            return result
        except Exception:
            logger.debug("Postgres trace read failed", exc_info=True)
            return []
