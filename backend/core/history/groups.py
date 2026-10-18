"""Commit groups: everything one agent action or run writes becomes one commit.

A group is bound to a ContextVar, so writes made anywhere under it (including
``asyncio.to_thread`` workers and LangGraph node tasks, which copy the
context) join it. Nested groups merge into the outermost one, which commits
when it exits.
"""

from __future__ import annotations

import concurrent.futures
import contextvars
import threading
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from core.history.messages import FileChange

if TYPE_CHECKING:
    from core.history.recorder import VaultHistory


@dataclass
class GroupPart:
    """One vault's accumulated writes inside a group."""

    data: dict[str, bytes | None] = field(default_factory=dict)
    first: dict[str, FileChange] = field(default_factory=dict)
    last: dict[str, FileChange] = field(default_factory=dict)
    existed: dict[str, bool] = field(default_factory=dict)
    holds: dict[str, int] = field(default_factory=dict)

    def _kept(self) -> list[str]:
        # A path created and removed inside one group never reaches history.
        return [p for p in self.first if self.existed[p] or self.data[p] is not None]

    def net_changes(self) -> list[FileChange]:
        # Who first touched a path, but how it ended: a removed path reports its removal.
        return [self.first[p] if self.data[p] is not None else self.last[p] for p in self._kept()]

    def net_data(self) -> dict[str, bytes | None]:
        return {p: self.data[p] for p in self._kept()}


class CommitGroup:
    """Writes collected under one :func:`commit_group` block."""

    def __init__(
        self,
        *,
        agent: str = "",
        action: str = "",
        reason: str = "",
        subject: str = "",
        preamble: str = "",
        reverts: str = "",
    ) -> None:
        self.id = "grp_" + uuid.uuid4().hex[:16]
        self.agent = agent
        self.action = action
        self.reason = reason
        self.subject = subject
        self.preamble = preamble
        self.reverts = reverts
        self.sentinel = ""
        self.run_id = ""
        self.futures: list[concurrent.futures.Future[str | None]] = []
        self._parts: dict[VaultHistory, GroupPart] = {}
        self._lock = threading.Lock()

    def add(
        self,
        recorder: VaultHistory,
        data: dict[str, bytes | None],
        changes: list[FileChange],
        existed: dict[str, bool],
        run_id: str,
    ) -> None:
        """Merge one write into the group (first writer/action per path wins)."""
        with self._lock:
            part = self._parts.setdefault(recorder, GroupPart())
            for change in changes:
                part.first.setdefault(change.path, change)
                part.last[change.path] = change
                part.existed.setdefault(change.path, existed[change.path])
                part.holds[change.path] = part.holds.get(change.path, 0) + 1
            part.data.update(data)
            if run_id and not self.run_id:
                self.run_id = run_id

    def close(self) -> None:
        """Queue one commit per vault this group wrote to."""
        with self._lock:
            parts, self._parts = self._parts, {}
        for recorder, part in parts.items():
            self.futures.append(recorder.submit_part(self, part))


_group_var: contextvars.ContextVar[CommitGroup | None] = contextvars.ContextVar(
    "loom_history_group", default=None
)


def active_group() -> CommitGroup | None:
    """The group writes in this context currently join, if any."""
    return _group_var.get()


@asynccontextmanager
async def commit_group(**labels: Any) -> AsyncIterator[CommitGroup]:
    """Collect writes made inside the block into one commit.

    Keyword labels (``agent``, ``action``, ``reason``, ``subject``,
    ``preamble``, ``reverts``) override what the commit message would infer.
    Inside another group this yields the outer group and commits nothing
    itself; only labels the outer group left empty are filled in.
    """
    outer = _group_var.get()
    if outer is not None:
        for key, value in labels.items():
            if value and not getattr(outer, key):
                setattr(outer, key, value)
        yield outer
        return
    group = CommitGroup(**labels)
    token = _group_var.set(group)
    try:
        yield group
    finally:
        _group_var.reset(token)
        group.close()


def set_sentinel_result(status: str) -> None:
    """Record Sentinel's verdict for the commit the current group will make."""
    group = _group_var.get()
    if group is not None and status:
        group.sentinel = status
