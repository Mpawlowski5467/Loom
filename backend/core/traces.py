"""LLM call tracing — record every provider.chat() exchange for inspection."""

from __future__ import annotations

import contextvars
import json
import logging
import re
import secrets
import shutil
import threading
from collections import deque
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from core.trace_pg import PgTraceMirror

logger = logging.getLogger(__name__)

_MAX_TRACES = 500

# ``TraceStore`` defines a method named ``list`` (mirrors the API verb), which
# shadows the builtin ``list`` in the annotations of methods defined after it.
# These aliases capture the builtin generic here, before the shadowing, so those
# later signatures can spell their list types without tripping mypy [valid-type].
_TraceRecordList = list["TraceRecord"]
_RunSummaryList = list[dict[str, Any]]

# Disk traces live under ``<traces_dir>/YYYY-MM-DD/``; retention deletes only
# directories whose name matches this exact pattern, never anything else.
_DATE_DIR_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class TraceRecord:
    """A single recorded LLM exchange."""

    def __init__(
        self,
        provider: str,
        model: str,
        messages: list[dict[str, Any]],
        system: str,
        response: str,
        duration_ms: int,
        error: str = "",
        caller: str = "",
        run_id: str = "",
        step: str = "",
    ) -> None:
        self.id = f"trc_{secrets.token_hex(4)}"
        self.timestamp = datetime.now(UTC).isoformat()
        self.provider = provider
        self.model = model
        self.system = system
        self.messages = messages
        self.response = response
        self.duration_ms = duration_ms
        self.error = error
        self.caller = caller
        self.run_id = run_id
        self.step = step

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "timestamp": self.timestamp,
            "provider": self.provider,
            "model": self.model,
            "caller": self.caller,
            "run_id": self.run_id,
            "step": self.step,
            "system": self.system,
            "messages": self.messages,
            "response": self.response,
            "duration_ms": self.duration_ms,
            "error": self.error,
        }


class TraceStore:
    """In-memory ring buffer of recent LLM exchanges, optionally mirrored to disk."""

    def __init__(self, max_items: int = _MAX_TRACES) -> None:
        self._items: deque[TraceRecord] = deque(maxlen=max_items)
        self._lock = threading.Lock()
        self._disk_dir: Path | None = None
        self._pg_mirror: PgTraceMirror | None = None
        self._vault_label: str = ""

    def set_disk_dir(self, path: Path | None) -> None:
        """Mirror new traces to disk under ``path/<date>/<id>.json``. None disables."""
        self._disk_dir = path

    def set_vault_label(self, label: str) -> None:
        """Tag Postgres-mirrored rows with the active vault.

        The disk mirror is per-vault by construction (its dir lives under the
        vault); the shared Postgres tables need an explicit tag so reads can
        scope to the active vault.
        """
        self._vault_label = label

    @property
    def disk_dir(self) -> Path | None:
        """The configured disk mirror directory, if any (retention sweeps it)."""
        return self._disk_dir

    def set_pg_mirror(self, mirror: PgTraceMirror | None) -> None:
        """Also enqueue new traces/run summaries to Postgres. None disables.

        Strictly additive: the in-memory ring and the disk mirror behave
        exactly the same with or without a Postgres mirror.
        """
        self._pg_mirror = mirror

    @property
    def pg_mirror(self) -> PgTraceMirror | None:
        """The configured Postgres mirror, if any (routers read through it)."""
        return self._pg_mirror

    def add(self, record: TraceRecord) -> None:
        with self._lock:
            self._items.append(record)
        if self._pg_mirror is not None:
            self._pg_mirror.enqueue_trace({**record.to_dict(), "vault": self._vault_label})
        if self._disk_dir is not None:
            try:
                date_dir = self._disk_dir / record.timestamp[:10]
                date_dir.mkdir(parents=True, exist_ok=True)
                (date_dir / f"{record.id}.json").write_text(
                    json.dumps(record.to_dict(), indent=2), encoding="utf-8"
                )
            except OSError:
                logger.warning("Failed to persist trace %s", record.id, exc_info=True)

    def list(
        self,
        limit: int = 50,
        caller: str | None = None,
        since_id: str | None = None,
    ) -> list[TraceRecord]:
        with self._lock:
            items = list(self._items)
        if since_id is not None:
            cut = next((i for i, r in enumerate(items) if r.id == since_id), -1)
            if cut >= 0:
                items = items[cut + 1 :]
        if caller is not None:
            items = [r for r in items if r.caller == caller]
        return list(reversed(items[-limit:]))

    def get(self, trace_id: str) -> TraceRecord | None:
        with self._lock:
            for r in self._items:
                if r.id == trace_id:
                    return r
        return None

    def by_run(self, run_id: str) -> _TraceRecordList:
        """Return all in-memory traces for a run, oldest first."""
        with self._lock:
            return [r for r in self._items if r.run_id == run_id]

    def write_run_summary(self, summary: dict[str, Any]) -> None:
        """Persist a multi-step run summary under ``<disk_dir>/<date>/run-<id>.json``.

        Mirrors :meth:`add` — a no-op when no disk dir is configured (though a
        configured Postgres mirror is still fed for durability). The summary
        reifies the *shape* of a graph run (its ordered steps), including steps
        that emitted no LLM call and so have no :class:`TraceRecord`.
        """
        if self._pg_mirror is not None:
            self._pg_mirror.enqueue_run({**summary, "vault": self._vault_label})
        if self._disk_dir is None:
            return
        run_id = summary.get("run_id", "")
        started = str(summary.get("started", "")) or datetime.now(UTC).isoformat()
        try:
            date_dir = self._disk_dir / started[:10]
            date_dir.mkdir(parents=True, exist_ok=True)
            (date_dir / f"run-{run_id}.json").write_text(
                json.dumps(summary, indent=2), encoding="utf-8"
            )
        except OSError:
            logger.warning("Failed to persist run summary %s", run_id, exc_info=True)

    def list_run_summaries(self, limit: int = 50) -> _RunSummaryList:
        """Return recent run summaries from disk, newest first.

        Run files are named ``run-<random-hex>.json``, so their filenames carry
        no ordering. Candidate files are sorted by modification time (newest
        first) *before* truncating to ``limit`` so the newest runs survive the
        cut; the surviving summaries are then re-sorted by their ``started``
        field for the final most-recent-first ordering the Runs view expects.
        """
        if self._disk_dir is None or not self._disk_dir.exists():
            return []
        files: list[tuple[float, Path]] = []
        for date_dir in self._disk_dir.iterdir():
            if date_dir.is_dir():
                for path in date_dir.glob("run-*.json"):
                    try:
                        files.append((path.stat().st_mtime, path))
                    except OSError:
                        continue
        files.sort(key=lambda item: item[0], reverse=True)
        summaries: list[dict[str, Any]] = []
        for _mtime, path in files:
            try:
                summaries.append(json.loads(path.read_text(encoding="utf-8")))
            except (OSError, json.JSONDecodeError):
                continue
            if len(summaries) >= limit:
                break
        summaries.sort(key=lambda s: str(s.get("started", "")), reverse=True)
        return summaries[:limit]

    def get_run_summary(self, run_id: str) -> dict[str, Any] | None:
        """Return one run summary from disk by id, or None."""
        if self._disk_dir is None or not self._disk_dir.exists():
            return None
        for date_dir in self._disk_dir.iterdir():
            if not date_dir.is_dir():
                continue
            path = date_dir / f"run-{run_id}.json"
            if path.exists():
                try:
                    data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
                    return data
                except (OSError, json.JSONDecodeError):
                    return None
        return None


_store = TraceStore()


def get_trace_store() -> TraceStore:
    return _store


def prune_old_traces(traces_dir: Path, keep_days: int = 30) -> int:
    """Delete trace date-directories older than ``keep_days``.

    The on-disk trace store (per-call JSON files + run summaries) grows
    unboundedly without this; :class:`core.trace_retention.TraceRetention`
    calls it on a daily sweep (invoking it on every :meth:`TraceStore.add`
    would be far too hot). It is intentionally conservative: it only removes
    directories whose name is an exact ``YYYY-MM-DD`` date strictly older than
    the cutoff, ignores everything else, and swallows per-directory errors so a
    single un-removable directory never aborts the sweep.

    Args:
        traces_dir: Root directory holding ``YYYY-MM-DD`` trace subdirectories.
        keep_days: Number of days to retain (today counts as day 0). Directories
            dated more than this many days before today are removed.

    Returns:
        The number of date-directories removed.
    """
    if keep_days < 0 or not traces_dir.exists():
        return 0
    today = datetime.now(UTC).date()
    removed = 0
    for child in traces_dir.iterdir():
        if not child.is_dir() or not _DATE_DIR_RE.match(child.name):
            continue
        try:
            dir_date = datetime.strptime(child.name, "%Y-%m-%d").date()
        except ValueError:
            continue
        if (today - dir_date).days <= keep_days:
            continue
        try:
            shutil.rmtree(child)
            removed += 1
        except OSError:
            logger.warning("Failed to prune trace dir %s", child, exc_info=True)
    return removed


# Caller tagging uses ContextVar (not threading.local) because Loom runs on
# a single-threaded asyncio event loop where many coroutines share the same
# OS thread. With threading.local, a concurrent request could read another
# request's caller label — that exact bug caused bubble calls to be tagged
# as the running captures pipeline. ContextVar is per-task, so each
# coroutine sees only its own caller.
_caller_var: contextvars.ContextVar[str] = contextvars.ContextVar("loom_trace_caller", default="")

# A multi-step run (e.g. a Researcher graph invocation) gets one run_id; each
# graph node sets the current step. Both use ContextVar for the same per-task
# isolation reason as the caller above — a graph node's child provider calls
# inherit the run/step through ``await`` automatically.
_run_var: contextvars.ContextVar[str] = contextvars.ContextVar("loom_trace_run", default="")
_step_var: contextvars.ContextVar[str] = contextvars.ContextVar("loom_trace_step", default="")


def set_caller(label: str) -> None:
    """Tag subsequent provider calls in this task with a caller label."""
    _caller_var.set(label)


def get_caller() -> str:
    return _caller_var.get()


def clear_caller() -> None:
    _caller_var.set("")


def set_run(run_id: str) -> None:
    """Tag subsequent provider calls in this task with a run id."""
    _run_var.set(run_id)


def get_run() -> str:
    return _run_var.get()


def clear_run() -> None:
    """Clear both the run id and the current step for this task."""
    _run_var.set("")
    _step_var.set("")


def set_step(step: str) -> None:
    """Tag subsequent provider calls in this task with the current step name."""
    _step_var.set(step)


def get_step() -> str:
    return _step_var.get()
