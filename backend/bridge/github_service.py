"""GitHub Bridge orchestration into the shared capture ingress, plus the
background poller that drives it.

Cursor state (per repo, per feed) lives in ``github-sync.json`` next to
``config.yaml``. Cursors are an *efficiency* layer only — correctness comes
from capture-ingress idempotency on each item's ``external_id``, so a lost or
stale cursor can re-list activity but never duplicate a filed capture.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any, TypedDict

from bridge.github import GitHubClient, GitHubError, fetch_repo_activity
from core.capture_ingress import ingest_capture
from core.config import GlobalConfig, settings

if TYPE_CHECKING:
    from core.vault import VaultManager

logger = logging.getLogger(__name__)


class GitHubSyncConflictError(RuntimeError):
    """Raised when the active vault changes during a GitHub synchronization."""


class RepoSyncResult(TypedDict):
    repo: str
    fetched: int
    created: int
    deduplicated: int
    error: str


class GitHubSyncResult(TypedDict):
    synced_at: str
    repos: list[RepoSyncResult]
    created: int
    deduplicated: int
    errors: int


def _cursor_path() -> Path:
    return Path(settings.config_path).parent / "github-sync.json"


def _load_cursors() -> dict[str, dict[str, str]]:
    try:
        data = json.loads(_cursor_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    repos = data.get("repos")
    if not isinstance(repos, dict):
        return {}
    return {
        str(repo): {k: str(v) for k, v in feeds.items() if isinstance(v, str)}
        for repo, feeds in repos.items()
        if isinstance(feeds, dict)
    }


def _save_cursors(cursors: dict[str, dict[str, str]]) -> None:
    path = _cursor_path()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"repos": cursors}, indent=2), encoding="utf-8")
    tmp.replace(path)


def _max_iso(a: str, b: str) -> str:
    """Return the later of two ISO timestamps (lexicographic is safe for
    GitHub's uniform ``YYYY-MM-DDTHH:MM:SSZ`` shape)."""
    return max(a, b)


async def sync_github(
    *,
    vm: VaultManager | None = None,
    client: GitHubClient | None = None,
) -> GitHubSyncResult:
    """Poll all configured repos once and ingest activity as Inbox captures.

    One repo's failure does not abort the rest — it is recorded in that
    repo's result slot and the loop moves on.
    """
    if vm is None:
        from core.vault import get_vault_manager

        vm = get_vault_manager()
    vault_root = vm.active_vault_dir().resolve()
    if not vault_root.exists() or not (vault_root / "vault.yaml").exists():
        raise GitHubSyncConflictError("No active vault is available for GitHub sync")

    config = GlobalConfig.load(vm.config_path())
    gh = config.github
    if not gh.repos:
        raise GitHubError("Add at least one repository first")

    cursors = _load_cursors()
    default_since = (datetime.now(UTC) - timedelta(hours=gh.lookback_hours)).isoformat()

    owns_client = client is None
    client = client or GitHubClient(gh.token)
    results: list[RepoSyncResult] = []
    totals = {"created": 0, "deduplicated": 0, "errors": 0}
    try:
        for repo in gh.repos:
            if vm.active_vault_dir().resolve() != vault_root:
                raise GitHubSyncConflictError("The active vault changed; retry GitHub sync")
            repo_cursor = dict(cursors.get(repo, {}))
            result: RepoSyncResult = {
                "repo": repo,
                "fetched": 0,
                "created": 0,
                "deduplicated": 0,
                "error": "",
            }
            results.append(result)
            commits_since = repo_cursor.get("commits") or default_since
            issues_since = repo_cursor.get("issues") or default_since
            new_commits_since = commits_since
            new_issues_since = issues_since
            try:
                async for item in fetch_repo_activity(
                    client,
                    repo,
                    commits_since=commits_since if gh.include_commits else None,
                    issues_since=(
                        issues_since if (gh.include_issues or gh.include_pull_requests) else None
                    ),
                    include_commits=gh.include_commits,
                    include_issues=gh.include_issues,
                    include_pull_requests=gh.include_pull_requests,
                ):
                    result["fetched"] += 1
                    if item.kind == "commit":
                        new_commits_since = _max_iso(new_commits_since, item.occurred_at)
                    else:
                        new_issues_since = _max_iso(new_issues_since, item.occurred_at)
                    if vm.active_vault_dir().resolve() != vault_root:
                        raise GitHubSyncConflictError("The active vault changed; retry GitHub sync")
                    ingested = await ingest_capture(
                        vault_root,
                        title=item.title,
                        body=item.to_capture_markdown(),
                        source="bridge:github",
                        tags=("github", item.kind),
                        external_id=item.external_id,
                        provenance=item.provenance(),
                    )
                    result["created"] += int(ingested.created)
                    result["deduplicated"] += int(ingested.deduplicated)
            except GitHubSyncConflictError:
                raise
            except Exception as exc:  # one repo down must not sink the rest
                logger.warning("GitHub sync failed for %s", repo, exc_info=True)
                result["error"] = str(exc)
                totals["errors"] += 1
            repo_cursor["commits"] = new_commits_since
            repo_cursor["issues"] = new_issues_since
            cursors[repo] = repo_cursor
            # Persist per repo so a crash mid-sync loses at most one repo's
            # cursor progress (re-listing is safe thanks to ingress dedup).
            try:
                _save_cursors(cursors)
            except OSError:
                logger.warning("Could not persist GitHub sync cursors", exc_info=True)
            totals["created"] += result["created"]
            totals["deduplicated"] += result["deduplicated"]
    finally:
        if owns_client:
            await client.aclose()

    return {
        "synced_at": datetime.now(UTC).isoformat(),
        "repos": results,
        "created": totals["created"],
        "deduplicated": totals["deduplicated"],
        "errors": totals["errors"],
    }


# ---------------------------------------------------------------------------
# Background poller
# ---------------------------------------------------------------------------


class GitHubSyncService:
    """Interval poller that runs :func:`sync_github` when the bridge is enabled.

    Config is re-read every tick, so Settings edits (enable, repos, interval)
    apply without a restart; :meth:`notify` wakes the loop early after a save.
    """

    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None
        self._stop = asyncio.Event()
        self._wake = asyncio.Event()
        self._last_run: str = ""
        self._last_error: str = ""
        self._last_created: int = 0

    async def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._loop(), name="github-sync")

    async def aclose(self) -> None:
        self._stop.set()
        self._wake.set()
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task

    def notify(self) -> None:
        """Wake the loop immediately (e.g. after a settings save)."""
        self._wake.set()

    def status(self) -> dict[str, Any]:
        """Last-run state for the automations status endpoint."""
        return {
            "running": self._task is not None and not self._task.done(),
            "last_run": self._last_run,
            "last_error": self._last_error,
            "last_created": self._last_created,
        }

    async def _loop(self) -> None:
        while not self._stop.is_set():
            config = GlobalConfig.load(settings.config_path)
            interval_s = max(5, config.github.interval_minutes) * 60
            if config.github.enabled and config.github.repos:
                try:
                    result = await sync_github()
                    self._last_run = result["synced_at"]
                    self._last_created = result["created"]
                    self._last_error = (
                        f"{result['errors']} repo(s) failed" if result["errors"] else ""
                    )
                except Exception as exc:
                    logger.warning("GitHub sync tick failed", exc_info=True)
                    self._last_run = datetime.now(UTC).isoformat()
                    self._last_error = str(exc)
            self._wake.clear()
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), timeout=interval_s)


_service: GitHubSyncService | None = None


def get_github_sync_service() -> GitHubSyncService:
    """Return the process-wide GitHub sync poller."""
    global _service
    if _service is None:
        _service = GitHubSyncService()
    return _service
