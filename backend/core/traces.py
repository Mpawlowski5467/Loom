"""LLM call tracing — record every provider.chat() exchange for inspection."""

from __future__ import annotations

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

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "timestamp": self.timestamp,
            "provider": self.provider,
            "model": self.model,
            "caller": self.caller,
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


_store = TraceStore()


def get_trace_store() -> TraceStore:
    return _store


_caller_ctx = threading.local()


def set_caller(label: str) -> None:
    """Tag subsequent provider calls on this thread with a caller label."""
    _caller_ctx.label = label


def get_caller() -> str:
    return getattr(_caller_ctx, "label", "")


def clear_caller() -> None:
    _caller_ctx.label = ""
