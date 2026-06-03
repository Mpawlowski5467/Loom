"""Safe vault IO chokepoint for agents.

This module is the *single* place agents go through to write vault notes.
It wraps the low-level primitives in ``core/notes.py`` with two guarantees:

1. **Path safety**: every path is validated to live inside the vault's
   ``threads/`` tree, not under ``.archive/``, and not equal to
   ``rules/prime.md``.
2. **Audit hook**: every mutation goes through ``atomic_write_text`` so the
   graph dirty-flag and watchdog observe the write the same way.

Agents don't call ``core/notes.py:atomic_write_text`` directly anymore;
they use ``vault_io.write_note(vault_root, path, meta, body)``. The wider
style-guide invariant ("agents don't write vault files directly") is then
a single import boundary you can grep for.

Notes:
- Reads (``parse_note``, scans) still hit the filesystem directly via the
  callers' existing helpers. Locking down reads gains little here and would
  multiply the diff. Writes are where correctness matters.
- The ``rules/`` and ``agents/`` subtrees are outside this module's scope —
  agents already touch their own ``memory.md`` and changelog through
  dedicated helpers; ``prime.md`` is forbidden at the BaseAgent layer.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from core.notes import atomic_write_text, note_to_file_content

logger = logging.getLogger(__name__)


class VaultIOError(Exception):
    """Raised when an agent tries to write to a path the vault won't accept."""


def write_note(
    vault_root: Path,
    path: Path,
    meta: dict[str, Any],
    body: str,
) -> None:
    """Write a note to ``path`` after validating the path is safe.

    ``path`` must be inside ``vault_root/threads/`` and end in ``.md``.
    ``.archive/`` paths and ``rules/prime.md`` are rejected.
    """
    safe_path = _check_writable(vault_root, path)
    atomic_write_text(safe_path, note_to_file_content(meta, body))


def write_text(
    vault_root: Path,
    path: Path,
    content: str,
    *,
    mark_graph_dirty: bool = True,
) -> None:
    """Write arbitrary text (e.g. a folder ``_index.md``) under vault validation.

    Use this for non-note writes (index files, audit reports) that still
    live inside ``threads/``. Notes proper should go through ``write_note``.
    """
    safe_path = _check_writable(vault_root, path)
    atomic_write_text(safe_path, content, mark_graph_dirty=mark_graph_dirty)


def _check_writable(vault_root: Path, path: Path) -> Path:
    """Validate the path is a safe write target under the vault."""
    threads_dir = (vault_root / "threads").resolve()
    try:
        resolved = path.resolve() if path.exists() else path.absolute()
    except OSError as exc:
        raise VaultIOError(f"Cannot resolve path: {exc}") from exc

    if resolved.suffix != ".md":
        raise VaultIOError(f"Vault writes must be .md files, got {resolved.suffix!r}")

    if ".archive" in resolved.parts:
        raise VaultIOError(f"Refusing to write into .archive/: {resolved}")

    # prime.md guard is enforced at BaseAgent layer too — restate here so
    # the static check fires even on direct callers.
    prime = (vault_root / "rules" / "prime.md").resolve()
    if resolved == prime:
        raise VaultIOError("rules/prime.md is immutable to agents")

    # Threads-only constraint: most agent writes go under threads/. Scribe
    # writes folder _index.md files and Archivist writes audit reports —
    # both of which still live under threads/. Anything outside is
    # suspicious enough to refuse.
    try:
        resolved.relative_to(threads_dir)
    except ValueError as exc:
        raise VaultIOError(f"Path {resolved} is outside the vault's threads/ directory") from exc

    return resolved
