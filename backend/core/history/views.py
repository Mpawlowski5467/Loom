"""JSON views of history commits for the API."""

from __future__ import annotations

from typing import Any

from core.history.git import GitRepo, LogEntry
from core.history.messages import parse_trailers

_MAX_FILE_BYTES = 200_000
_MAX_PATCH_CHARS = 500_000
_MAX_DIFF_FILES = 100
_STATUS_NAMES = {"A": "added", "D": "deleted", "M": "modified"}


def _first(trailers: dict[str, list[str]], key: str) -> str:
    values = trailers.get(key)
    return values[0] if values else ""


def entry_to_dict(entry: LogEntry) -> dict[str, Any]:
    """Summarize one commit: who, what, why, Sentinel's verdict, and its files."""
    subject = entry.message.splitlines()[0] if entry.message else ""
    trailers = parse_trailers(entry.message)
    files = entry.files
    return {
        "sha": entry.sha,
        "short_sha": entry.sha[:10],
        "subject": subject,
        "author": entry.author,
        "date": entry.date,
        "agents": trailers.get("Agent", []) or [entry.author],
        "action": _first(trailers, "Action"),
        "reason": _first(trailers, "Reason"),
        "sentinel": _first(trailers, "Sentinel"),
        "run_id": _first(trailers, "Loom-Run"),
        "group": _first(trailers, "Loom-Group"),
        "reverts": _first(trailers, "Reverts"),
        "files": files,
        "revertible": bool(entry.parents)
        and len(entry.parents) == 1
        and all(f.startswith("threads/") and f.endswith(".md") for f in files),
    }


def _decode(data: bytes | None) -> tuple[str | None, bool]:
    if data is None:
        return None, False
    truncated = len(data) > _MAX_FILE_BYTES
    return data[:_MAX_FILE_BYTES].decode("utf-8", "replace"), truncated


def diff_payload(repo: GitRepo, sha: str) -> dict[str, Any] | None:
    """Commit summary plus before/after text per file and the unified patch."""
    full = repo.resolve_commit(sha)
    if full is None:
        return None
    raw = repo.text("log", "-1", "--format=%H%x1f%P%x1f%an%x1f%aI%x1f%B", full)
    commit, parents, author, date, message = raw.split("\x1f", 4)
    changed = repo.changed_files(full)
    entry = LogEntry(
        sha=commit.strip(),
        parents=parents.split(),
        author=author,
        date=date,
        message=message.strip(),
        files=[path for _, path in changed],
    )
    parent = entry.parents[0] if entry.parents else None
    files = []
    for status, path in changed[:_MAX_DIFF_FILES]:
        before, before_cut = _decode(repo.blob(parent, path) if parent else None)
        after, after_cut = _decode(repo.blob(full, path))
        files.append(
            {
                "path": path,
                "status": _STATUS_NAMES.get(status[:1], status),
                "before": before,
                "after": after,
                "truncated": before_cut or after_cut,
            }
        )
    patch = repo.patch(full)
    return {
        **entry_to_dict(entry),
        "file_diffs": files,
        "files_truncated": len(changed) > _MAX_DIFF_FILES,
        "patch": patch[:_MAX_PATCH_CHARS],
        "patch_truncated": len(patch) > _MAX_PATCH_CHARS,
    }
