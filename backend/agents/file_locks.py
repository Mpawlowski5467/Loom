"""Path-keyed asyncio locks for agent file IO.

Agents read-modify-write notes and folder ``_index.md`` files. When multiple
captures process concurrently, the Weaver → Spider → Scribe pipeline can
have two coroutines hitting the same ``_index.md`` (or even the same note)
at once. ``atomic_write_text`` guarantees the *individual file* write is
atomic, but it does nothing about lost updates between read and write.

Usage:

    from agents.file_locks import path_lock

    async with path_lock(note_path):
        note = parse_note(note_path)
        ... mutate ...
        atomic_write_text(note_path, ...)

Locks are keyed by the resolved absolute path so symlinks and relative
paths can't sneak past. The lock dict is process-local; concurrent
processes would still race, but a single FastAPI server is the common
deployment.
"""

from __future__ import annotations

import asyncio
import contextlib
import weakref
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


# WeakValueDictionary so locks for paths nobody is using anymore are GC'd.
# Without weak refs, a long-running process accumulates one lock per
# ever-touched path.
_LOCKS: "weakref.WeakValueDictionary[str, asyncio.Lock]" = weakref.WeakValueDictionary()


def _key(path: Path) -> str:
    # Resolve when possible so symlinks and relative variants share a lock.
    try:
        return str(path.resolve())
    except OSError:
        return str(path.absolute())


def _get_lock(path: Path) -> asyncio.Lock:
    key = _key(path)
    lock = _LOCKS.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _LOCKS[key] = lock
    return lock


@contextlib.asynccontextmanager
async def path_lock(path: Path) -> "AsyncIterator[None]":
    """Async context manager that serializes writers on ``path``.

    Two coroutines calling ``async with path_lock(p):`` against the same
    resolved path block each other until the inner block exits. The lock
    is held by strong reference for the duration of the ``async with`` so
    the WeakValueDictionary can't drop it mid-block.
    """
    lock = _get_lock(path)
    async with lock:
        yield


def _clear_for_tests() -> None:
    """Drop all cached locks. Test-only — production code should not call this."""
    _LOCKS.clear()
