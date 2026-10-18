"""Git-backed vault history.

The SQLite revision journal (``core.revisions``) stays the crash-safe write
path; this package mirrors every applied write into a git repository at the
vault root so history can be browsed, diffed, and reverted with ordinary git.
History is active only for vaults started with :func:`start_history` (the
app's active vault), so library and test callers that write to a temporary
vault never spawn git.
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path

from core.config import VaultConfig
from core.history.git import git_available
from core.history.groups import active_group, commit_group, set_sentinel_result
from core.history.recorder import VaultHistory

__all__ = [
    "VaultHistory",
    "commit_group",
    "current_group_id",
    "get_history",
    "notify_external_change",
    "on_mutation",
    "set_sentinel_result",
    "start_history",
    "stop_history",
    "unavailable_reason",
]

logger = logging.getLogger(__name__)
_registry: dict[Path, VaultHistory] = {}
_registry_lock = threading.Lock()


def start_history(vault_root: Path) -> VaultHistory | None:
    """Begin recording ``vault_root``'s writes, initializing its repo if needed."""
    root = vault_root.resolve()
    stop_history(root)
    if unavailable_reason(root):
        logger.info("Vault history inactive for %s: %s", root, unavailable_reason(root))
        return None
    config = VaultConfig.load(root / "vault.yaml").history
    recorder = VaultHistory(root, config)
    with _registry_lock:
        _registry[root] = recorder
    recorder.start()
    return recorder


def stop_history(vault_root: Path | None = None, timeout: float = 15.0) -> None:
    """Flush and stop one vault's recorder, or all of them."""
    with _registry_lock:
        if vault_root is None:
            stopping = list(_registry.values())
            _registry.clear()
        else:
            found = _registry.pop(vault_root.resolve(), None)
            stopping = [found] if found else []
    for recorder in stopping:
        recorder.stop(timeout)


def get_history(vault_root: Path) -> VaultHistory | None:
    """The running recorder for a vault, if history is active for it."""
    with _registry_lock:
        return _registry.get(vault_root.resolve())


def unavailable_reason(vault_root: Path) -> str:
    """Why history can't run for a vault, or an empty string when it can."""
    if not VaultConfig.load(vault_root / "vault.yaml").history.enabled:
        return "Vault history is turned off (history.enabled in vault.yaml)."
    if not git_available():
        return "Vault history needs git, which is not installed."
    return ""


def on_mutation(
    vault_root: Path,
    before: dict[str, str | None],
    after: dict[str, str | None],
    *,
    caller: str,
    run_id: str,
) -> None:
    """Hook for ``record_mutation``: route an applied write to history.

    Never raises: a history failure must not fail or roll back a vault write.
    """
    recorder = get_history(vault_root)
    if recorder is None:
        return
    try:
        recorder.record(before, after, caller=caller, run_id=run_id)
    except Exception:
        logger.warning("Could not record vault write in history", exc_info=True)


def notify_external_change(vault_root: Path) -> None:
    """Hook for the file watcher: a file changed, so (re)start the human-edit timer."""
    recorder = get_history(vault_root)
    if recorder is not None:
        recorder.schedule_sweep()


def current_group_id() -> str:
    """The commit-group id writes in this context will be committed under."""
    group = active_group()
    return group.id if group is not None and _registry else ""
