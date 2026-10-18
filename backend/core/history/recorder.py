"""Per-vault recorder that turns vault writes into git commits.

``core.revisions.record_mutation`` reports every applied write here. Writes
inside a :func:`commit_group` (an agent action, a pipeline run, a vault scan)
become one grouped commit when the outermost group exits. Agent writes outside
a group commit immediately. Plain human edits (the editor, files changed on
disk) are committed together after a quiet period. A single worker thread per
vault performs every git operation in order, so writes never wait on git.
"""

from __future__ import annotations

import concurrent.futures
import logging
import os
import queue
import threading
from collections.abc import Callable
from pathlib import Path
from typing import TypeVar

from core.config import VaultHistoryConfig
from core.history.git import GitRepo
from core.history.groups import CommitGroup, GroupPart, active_group
from core.history.messages import (
    HUMAN,
    CommitSpec,
    FileChange,
    build_message,
    explicit_human_action,
    identity_for,
    infer_change,
    normalize_agent,
    writer_from_content,
)

logger = logging.getLogger(__name__)
T = TypeVar("T")

_GITIGNORE_HEADER = (
    "# Managed by Loom vault history. Indexes, caches, and agent runtime state\n"
    "# are rebuildable or private, so they stay out of version control.\n"
)
_STATUS_ACTIONS = {"?": "created", "A": "created", "D": "deleted"}

Job = tuple[Callable[[], object], "concurrent.futures.Future[object]"]


def disk_bytes(text: str) -> bytes:
    """The bytes ``atomic_write_text`` puts on disk for ``text`` (text-mode newlines)."""
    return (text if os.linesep == "\n" else text.replace("\n", os.linesep)).encode("utf-8")


def _label_move(
    changes: list[FileChange], before: dict[str, str | None], after: dict[str, str | None]
) -> None:
    """Mark a ``record_move`` (one path vacated, one filled with the same text) as a move."""
    gone = [rel for rel, text in after.items() if text is None and before.get(rel) is not None]
    new = [rel for rel, text in after.items() if text is not None and before.get(rel) is None]
    if len(gone) != 1 or len(new) != 1 or before[gone[0]] != after[new[0]]:
        return
    by_path = {c.path: c for c in changes}
    source, dest = by_path[f"threads/{gone[0]}"], by_path[f"threads/{new[0]}"]
    source.action, source.reason = "moved", f"to {dest.path}"
    if dest.action == "created":
        dest.action, dest.reason = "moved", f"from {source.path}"


class VaultHistory:
    """Commits one vault's writes to its git repository."""

    def __init__(self, vault: Path, config: VaultHistoryConfig) -> None:
        self.vault = vault.resolve()
        self.config = config
        self.repo = GitRepo(self.vault)
        self.last_error = ""
        self._jobs: queue.Queue[Job | None] = queue.Queue()
        self._pending: dict[str, int] = {}
        self._pending_lock = threading.Lock()
        self._timer: threading.Timer | None = None
        self._timer_lock = threading.Lock()
        self._worker = threading.Thread(target=self._run, name="loom-history", daemon=True)

    # -- lifecycle ----------------------------------------------------------

    def start(self) -> None:
        """Start the worker and initialize (or catch up) the repository."""
        self._worker.start()
        self.submit(self._bootstrap)

    def stop(self, timeout: float = 15.0) -> None:
        """Commit outstanding human edits now, then stop the worker."""
        with self._timer_lock:
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None
        self.submit(lambda: self._sweep("Edits saved before Loom stopped"))
        self._jobs.put(None)
        self._worker.join(timeout)

    def submit(self, fn: Callable[[], T]) -> concurrent.futures.Future[T]:
        """Queue ``fn`` on the history worker; its result resolves the future."""
        future: concurrent.futures.Future[T] = concurrent.futures.Future()
        self._jobs.put((fn, future))  # type: ignore[arg-type]
        return future

    def flush(self, timeout: float = 30.0) -> None:
        """Block until every queued git operation has finished."""
        self.submit(lambda: None).result(timeout)

    def _run(self) -> None:
        while (job := self._jobs.get()) is not None:
            fn, future = job
            if not future.set_running_or_notify_cancel():
                continue
            try:
                future.set_result(fn())
            except BaseException as exc:  # a failed commit must not stop history
                if not getattr(exc, "quiet", False):
                    self.last_error = str(exc)
                    logger.warning("Vault history operation failed: %s", exc, exc_info=True)
                future.set_exception(exc)

    # -- recording writes ---------------------------------------------------

    def record(
        self,
        before: dict[str, str | None],
        after: dict[str, str | None],
        *,
        caller: str,
        run_id: str,
    ) -> None:
        """Route one applied write (threads-relative paths) to a commit."""
        caller_agent = normalize_agent(caller)
        explicit = explicit_human_action(caller)
        changes: list[FileChange] = []
        data: dict[str, bytes | None] = {}
        existed: dict[str, bool] = {}
        for rel, text in after.items():
            path = f"threads/{rel}"
            previous = before.get(rel)
            action, reason = infer_change(previous, text)
            writer = caller_agent
            if writer == HUMAN and not explicit:
                writer = writer_from_content(previous, text) or HUMAN
            if writer == HUMAN and not explicit and run_id:
                writer = "loom"  # inside an automated run, never a person
            changes.append(FileChange(path, writer, explicit or action, reason))
            data[path] = None if text is None else disk_bytes(text)
            existed[path] = previous is not None
        _label_move(changes, before, after)

        group = active_group()
        if group is not None:
            self._hold(dict.fromkeys(data, 1))
            group.add(self, data, changes, existed, run_id)
            return
        if not explicit and all(c.agent == HUMAN for c in changes):
            self.schedule_sweep()
            return
        spec = CommitSpec(changes=changes, action=explicit, run_id=run_id)
        holds = dict.fromkeys(data, 1)
        self._hold(holds)
        self.submit(lambda: self._commit(data, spec, holds))

    def submit_part(
        self, group: CommitGroup, part: GroupPart
    ) -> concurrent.futures.Future[str | None]:
        """Queue a closed group's accumulated writes as one commit."""
        spec = CommitSpec(
            changes=part.net_changes(),
            action=group.action,
            reason=group.reason,
            sentinel=group.sentinel or "not-reviewed",
            run_id=group.run_id,
            group_id=group.id,
            reverts=group.reverts,
            subject=group.subject,
            preamble=group.preamble,
            agents=list(
                dict.fromkeys(
                    [
                        *([group.agent] if group.agent else []),
                        *(c.agent for c in part.net_changes()),
                    ]
                )
            ),
        )
        data = part.net_data()
        return self.submit(lambda: self._commit(data, spec, part.holds))

    def schedule_sweep(self) -> None:
        """(Re)start the quiet-period timer for committing human edits."""
        with self._timer_lock:
            if self._timer is not None:
                self._timer.cancel()
            self._timer = threading.Timer(
                self.config.human_debounce_seconds,
                lambda: self.submit(lambda: self._sweep("Edited in the editor or on disk")),
            )
            self._timer.daemon = True
            self._timer.start()

    def pending_paths(self) -> set[str]:
        """Paths with writes recorded but not yet committed (open groups/queue)."""
        with self._pending_lock:
            return set(self._pending)

    def _hold(self, holds: dict[str, int]) -> None:
        with self._pending_lock:
            for path, count in holds.items():
                self._pending[path] = self._pending.get(path, 0) + count

    def _release(self, holds: dict[str, int]) -> None:
        with self._pending_lock:
            for path, count in holds.items():
                remaining = self._pending.get(path, 0) - count
                if remaining > 0:
                    self._pending[path] = remaining
                else:
                    self._pending.pop(path, None)

    # -- worker jobs --------------------------------------------------------

    def _commit(
        self, data: dict[str, bytes | None], spec: CommitSpec, holds: dict[str, int]
    ) -> str | None:
        try:
            if not data:
                return None
            writer = spec.agents[0] if spec.agents else spec.changes[0].agent
            return self.repo.commit_changes(data, build_message(spec), identity_for(writer))
        finally:
            self._release(holds)

    def sweep_now(self, reason: str) -> str | None:
        """Commit pending human edits immediately (runs on the worker)."""
        with self._timer_lock:
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None
        return self._sweep(reason)

    def _sweep(self, reason: str) -> str | None:
        pending = self.pending_paths()
        entries = [(code, path) for code, path in self.repo.status_entries() if path not in pending]
        if not entries:
            return None
        changes = [
            FileChange(path, HUMAN, _STATUS_ACTIONS.get(code.strip()[:1], "edited"))
            for code, path in entries
        ]
        spec = CommitSpec(changes=changes, reason=reason, agents=[HUMAN])
        return self.repo.commit_worktree(
            [p for _, p in entries], build_message(spec), identity_for(HUMAN)
        )

    def _bootstrap(self) -> None:
        if not self.repo.is_repo():
            self.repo.init()
        ignore = self.vault / ".gitignore"
        if not ignore.exists():
            ignore.write_text(
                _GITIGNORE_HEADER + "\n".join(self.config.ignore) + "\n", encoding="utf-8"
            )
        if self.repo.head() is not None:
            self._sweep("Changes made while Loom was not running")
            return
        paths = [path for _, path in self.repo.status_entries()]
        if not paths:
            return
        spec = CommitSpec(
            changes=[FileChange(p, "loom", "imported") for p in paths],
            action="initialized",
            reason="Vault history enabled",
            subject="loom: initialize vault history",
            agents=["loom"],
        )
        self.repo.commit_worktree(paths, build_message(spec), identity_for("loom"))
