"""LLM call tracing — record every provider.chat() exchange for inspection."""

from __future__ import annotations

import contextvars
import json
import logging
import secrets
import threading
from collections import deque
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_MAX_TRACES = 500


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

    def set_disk_dir(self, path: Path | None) -> None:
        """Mirror new traces to disk under ``path/<date>/<id>.json``. None disables."""
        self._disk_dir = path

    def add(self, record: TraceRecord) -> None:
        with self._lock:
            self._items.append(record)
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

    def by_run(self, run_id: str) -> list[TraceRecord]:
        """Return all in-memory traces for a run, oldest first."""
        with self._lock:
            return [r for r in self._items if r.run_id == run_id]

    def write_run_summary(self, summary: dict[str, Any]) -> None:
        """Persist a multi-step run summary under ``<disk_dir>/<date>/run-<id>.json``.

        Mirrors :meth:`add` — a no-op when no disk dir is configured. The summary
        reifies the *shape* of a graph run (its ordered steps), including steps
        that emitted no LLM call and so have no :class:`TraceRecord`.
        """
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

    def list_run_summaries(self, limit: int = 50) -> list[dict[str, Any]]:
        """Return recent run summaries from disk, newest first."""
        if self._disk_dir is None or not self._disk_dir.exists():
            return []
        files: list[Path] = []
        for date_dir in self._disk_dir.iterdir():
            if date_dir.is_dir():
                files.extend(date_dir.glob("run-*.json"))
        files.sort(key=lambda p: p.name, reverse=True)
        summaries: list[dict[str, Any]] = []
        for path in files:
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
                    return json.loads(path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    return None
        return None


_store = TraceStore()


def get_trace_store() -> TraceStore:
    return _store


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
