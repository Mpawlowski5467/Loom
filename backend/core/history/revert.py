"""Undo a history commit with a new revert commit; history is never rewritten.

The inverse change is computed with git's own three-way merge (what
``git revert`` does), validated by Sentinel *before* any file changes, then
applied through the journaled write path (``core.revisions``) so it is
crash-safe and recorded like every other write. The resulting commit uses the
standard ``Revert "<subject>"`` / ``This reverts commit <sha>.`` shape.
"""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import AsyncExitStack
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from core.history.git import GitRepo
from core.history.groups import commit_group
from core.history.messages import HUMAN
from core.history.recorder import VaultHistory

logger = logging.getLogger(__name__)
_BLOCKING = {"failed": {"failed"}, "warning": {"failed", "warning"}}
_SEVERITY = {"passed": 0, "unavailable": 1, "warning": 2, "failed": 3}
_reindex_tasks: set[asyncio.Task[None]] = set()


class RevertError(Exception):
    """A revert could not be performed; ``status`` is the HTTP status to report."""

    status = 409
    quiet = True  # an expected refusal, not a history failure worth a warning

    def __init__(self, message: str, paths: list[str] | None = None) -> None:
        super().__init__(message)
        self.paths = paths or []


class RevertNotFound(RevertError):
    status = 404


class RevertRejected(RevertError):
    status = 422


@dataclass
class RevertPlan:
    """What reverting one commit would change, relative to HEAD."""

    sha: str
    subject: str
    current: dict[str, str | None] = field(default_factory=dict)
    target: dict[str, str | None] = field(default_factory=dict)


def _text(data: bytes | None, path: str) -> str | None:
    if data is None:
        return None
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise RevertRejected(f"'{path}' is not a text note; revert it with git.") from exc
    return text if os.linesep == "\n" else text.replace(os.linesep, "\n")


def plan_revert(repo: GitRepo, sha: str, busy: set[str]) -> RevertPlan:
    """Compute the revert of ``sha`` onto HEAD (runs on the history worker)."""
    full = repo.resolve_commit(sha)
    if full is None:
        raise RevertNotFound(f"No history commit {sha}")
    parents = repo.parents(full)
    if not parents:
        raise RevertRejected("The initial history snapshot can't be reverted.")
    if len(parents) > 1:
        raise RevertRejected("Merge commits can't be reverted from Loom.")
    changed = [path for _, path in repo.changed_files(full)]
    outside = [p for p in changed if not p.startswith("threads/") or not p.endswith(".md")]
    if outside:
        raise RevertRejected("Only note changes can be reverted from Loom.", outside)
    running = [p for p in changed if p in busy]
    if running:
        raise RevertError("An agent run is still writing these notes; try again shortly.", running)
    plan = RevertPlan(sha=full, subject=repo.text("log", "-1", "--format=%s", full).strip())
    conflicts: list[str] = []
    for path in changed:
        after, before, head = (
            repo.blob(full, path),
            repo.blob(parents[0], path),
            repo.blob("HEAD", path),
        )
        if head == before:
            continue  # already back to the pre-commit version
        if head == after:
            result = before
        elif after is None or before is None or head is None:
            conflicts.append(path)
            continue
        else:
            result, clean = repo.merge_file(head, after, before)
            if not clean:
                conflicts.append(path)
                continue
        rel = path.removeprefix("threads/")
        plan.current[rel] = _text(head, path)
        plan.target[rel] = _text(result, path)
    if conflicts:
        raise RevertError(
            "Later changes overlap this commit. Revert the newer commits first.", conflicts
        )
    if not plan.target:
        raise RevertError("Nothing to revert: these notes already match the earlier version.")
    return plan


async def _validate(vault: Path, target: dict[str, str | None]) -> tuple[str, list[str]]:
    from agents.chain import ReadChain
    from agents.loom.sentinel import get_sentinel

    sentinel = get_sentinel()
    if sentinel is None:
        return "unavailable", ["Sentinel agent not initialized"]
    status, reasons = "passed", []
    for rel, text in sorted(target.items()):
        if text is None or rel.startswith(".archive/"):
            continue
        path = vault / "threads" / rel
        chain = await asyncio.to_thread(ReadChain(vault).execute, "sentinel", path)
        result = sentinel.validate_content(HUMAN, "revert", path, text, chain)
        if _SEVERITY.get(result.status, 0) > _SEVERITY.get(status, 0):
            status = result.status
        reasons += [
            f"{rel}: {reason}" for reason in result.reasons if reason != "All checks passed"
        ]
    return status, reasons


def _read(path: Path) -> str | None:
    return path.read_text(encoding="utf-8") if path.exists() else None


async def revert_commit(recorder: VaultHistory, sha: str) -> dict[str, Any]:
    """Revert ``sha``: plan, lock, validate with Sentinel, apply, commit, reindex."""
    from agents.file_locks import path_lock
    from core.revisions import RevisionConflict, apply_contents, archive_removed_notes

    vault = recorder.vault
    await asyncio.wrap_future(
        recorder.submit(lambda: recorder.sweep_now("Edits saved before a revert"))
    )
    plan = await asyncio.wrap_future(
        recorder.submit(lambda: plan_revert(recorder.repo, sha, recorder.pending_paths()))
    )
    short = plan.sha[:10]
    try:
        target = archive_removed_notes(
            plan.target, plan.current, f"revert-{short}", f"Reverted {short}"
        )
    except RevisionConflict as exc:
        raise RevertRejected(str(exc)) from exc
    status, reasons = await _validate(vault, target)
    if status in _BLOCKING[recorder.config.revert_block_on]:
        raise RevertRejected(f"Sentinel blocked this revert ({status}).", reasons)
    async with AsyncExitStack() as stack:
        for rel in sorted(target):
            await stack.enter_async_context(path_lock(vault / "threads" / rel))
        changed = [
            rel for rel, text in plan.current.items() if _read(vault / "threads" / rel) != text
        ]
        if changed:
            raise RevertError("These notes changed while the revert was prepared.", changed)
        async with commit_group(
            agent=HUMAN,
            action="revert",
            reason=f"Undo {short}: {plan.subject}",
            subject=f'Revert "{plan.subject}"',
            preamble=f"This reverts commit {plan.sha}.",
            reverts=plan.sha,
        ) as group:
            group.sentinel = status
            try:
                apply_contents(vault, target, caller="user:revert")
            except RevisionConflict as exc:
                raise RevertError(str(exc)) from exc
    new_sha = await asyncio.wrap_future(group.futures[0]) if group.futures else None
    _reindex(vault, target)
    return {
        "status": "reverted",
        "reverted": plan.sha,
        "sha": new_sha,
        "files": sorted(f"threads/{rel}" for rel in target),
        "sentinel": {"status": status, "reasons": reasons},
    }


def _reindex(vault: Path, target: dict[str, str | None]) -> None:
    """Refresh the note index now and queue vector re-embedding for reverted notes."""
    from core.events import publish_note_change
    from core.graph_state import mark_dirty
    from core.note_index import get_note_index
    from index.indexer import get_indexer

    index = get_note_index()
    written = []
    for rel, text in target.items():
        path = vault / "threads" / rel
        if text is None:
            index.remove_file(path)
        elif not rel.startswith(".archive/"):
            index.refresh_file(path)
            written.append(path)
    mark_dirty(vault / ".loom")
    publish_note_change()
    indexer = get_indexer()
    if indexer is None or not written:
        return

    async def _embed() -> None:
        for path in written:
            try:
                await indexer.index_note(path)
            except Exception:
                logger.warning("Re-embedding reverted note %s failed", path, exc_info=True)

    task = asyncio.get_running_loop().create_task(_embed())
    _reindex_tasks.add(task)
    task.add_done_callback(_reindex_tasks.discard)
