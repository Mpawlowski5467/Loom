"""Graph dirty-flag tracking.

The vault graph in ``.loom/graph.json`` is rebuilt on a 0.5s debounce by the
file watcher. Between an agent's write and the rebuild, the cached graph
lags reality. This module gives writers a way to signal staleness so the
next read rebuilds the graph eagerly instead of returning a known-stale
snapshot.

Mechanism: a one-byte marker file ``.loom/graph.dirty``. Any writer can call
``mark_dirty(loom_dir)`` after a vault mutation; the graph API checks
``is_dirty()`` before serving and rebuilds if so.

The file is the source of truth (rather than an in-memory flag) so that
multiple processes — the API server, a CLI script, the watcher — agree.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

_MARKER_NAME = "graph.dirty"


def mark_dirty(loom_dir: Path) -> None:
    """Record that the graph is stale and should be rebuilt on next read.

    Best-effort: failure to write the marker is logged at debug and does
    not raise — the worst case is the next reader sees a stale graph for
    one more poll interval.
    """
    try:
        loom_dir.mkdir(parents=True, exist_ok=True)
        marker = loom_dir / _MARKER_NAME
        # Touch with an empty body; mtime is what we care about.
        marker.touch(exist_ok=True)
    except OSError:
        logger.debug("Could not mark graph dirty at %s", loom_dir, exc_info=True)


def is_dirty(loom_dir: Path) -> bool:
    """Return True if the dirty marker exists (i.e., graph needs rebuild)."""
    return (loom_dir / _MARKER_NAME).exists()


def clear_dirty(loom_dir: Path) -> None:
    """Remove the dirty marker. Called by writers immediately after rebuild."""
    marker = loom_dir / _MARKER_NAME
    try:
        os.unlink(marker)
    except FileNotFoundError:
        pass
    except OSError:
        logger.debug("Could not clear graph dirty marker at %s", loom_dir, exc_info=True)
