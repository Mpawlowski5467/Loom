"""Disk-reading helpers for the traces router.

The trace store mirrors each call to ``<vault>/.loom/traces/<date>/<id>.json``;
these helpers page that history back in when a trace has been evicted from the
in-memory ring (and the optional Postgres mirror has no answer either).
"""

from __future__ import annotations

import json
import logging
import re
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from core.vault import VaultManager

logger = logging.getLogger(__name__)

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def traces_disk_dir(vm: VaultManager) -> Path:
    """Return the active vault's on-disk traces directory."""
    return vm.active_loom_dir() / "traces"


def read_trace_file(path: Path) -> dict[str, Any] | None:
    """Parse one persisted trace JSON file, or None if unreadable."""
    try:
        data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        return data
    except (OSError, json.JSONDecodeError):
        logger.debug("Failed to read trace file %s", path, exc_info=True)
        return None


def list_dates_with_traces(traces_dir: Path) -> list[str]:
    """Return sorted (newest first) YYYY-MM-DD directory names containing traces."""
    if not traces_dir.exists():
        return []
    dates = [d.name for d in traces_dir.iterdir() if d.is_dir() and _DATE_RE.match(d.name)]
    dates.sort(reverse=True)
    return dates


def find_on_disk(traces_dir: Path, trace_id: str) -> dict[str, Any] | None:
    """Look for a single trace_id by scanning recent date folders (newest first)."""
    if not traces_dir.exists():
        return None
    # The trace id has no embedded date, so we have to scan. Limit to the
    # most recent ~30 days so a deep history doesn't blow the request budget.
    today = date.today()
    for offset in range(0, 30):
        day = (today - timedelta(days=offset)).isoformat()
        candidate = traces_dir / day / f"{trace_id}.json"
        if candidate.exists():
            return read_trace_file(candidate)
    # Fall back to scanning whatever dates exist on disk.
    for day_name in list_dates_with_traces(traces_dir):
        try:
            candidate = traces_dir / day_name / f"{trace_id}.json"
        except (OSError, ValueError):
            continue
        if candidate.exists():
            return read_trace_file(candidate)
    return None
