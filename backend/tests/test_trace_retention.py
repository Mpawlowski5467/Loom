"""Tests for the daily trace-retention sweep (disk mirror + Postgres)."""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from core.trace_retention import TraceRetention
from core.traces import TraceStore, get_trace_store


class RecordingMirror:
    """Duck-typed Postgres mirror that records prune() calls."""

    def __init__(self) -> None:
        self.pruned_with: list[int] = []

    async def prune(self, keep_days: int) -> int:
        self.pruned_with.append(keep_days)
        return 2


@pytest.fixture()
def clean_store() -> Iterator[TraceStore]:
    store = get_trace_store()
    yield store
    store.set_disk_dir(None)
    store.set_pg_mirror(None)


def _make_date_dirs(root: Path) -> tuple[Path, Path]:
    """Create one prunable and one recent trace date-directory under root."""
    old = root / (datetime.now(UTC).date() - timedelta(days=45)).isoformat()
    recent = root / datetime.now(UTC).date().isoformat()
    for d in (old, recent):
        d.mkdir(parents=True)
        (d / "trc_x.json").write_text("{}", encoding="utf-8")
    return old, recent


class TestSweepOnce:
    @pytest.mark.asyncio
    async def test_prunes_disk_and_pg(self, tmp_path: Path, clean_store: TraceStore) -> None:
        old, recent = _make_date_dirs(tmp_path)
        clean_store.set_disk_dir(tmp_path)
        mirror = RecordingMirror()
        clean_store.set_pg_mirror(mirror)  # type: ignore[arg-type]

        await TraceRetention(keep_days=30).sweep_once()

        assert not old.exists()
        assert recent.exists()
        assert mirror.pruned_with == [30]

    @pytest.mark.asyncio
    async def test_noop_without_disk_dir_or_mirror(self, clean_store: TraceStore) -> None:
        clean_store.set_disk_dir(None)
        assert clean_store.pg_mirror is None
        await TraceRetention(keep_days=30).sweep_once()  # must not raise


class TestLifecycle:
    def test_start_is_noop_when_disabled(self) -> None:
        retention = TraceRetention(keep_days=-1)
        # A disabled retention never creates the task (no event loop needed).
        retention.start()
        assert retention._task is None

    @pytest.mark.asyncio
    async def test_start_sweeps_immediately_and_aclose_cancels(
        self, tmp_path: Path, clean_store: TraceStore
    ) -> None:
        old, recent = _make_date_dirs(tmp_path)
        clean_store.set_disk_dir(tmp_path)

        retention = TraceRetention(keep_days=30, interval_s=3600)
        retention.start()
        retention.start()  # idempotent — must not spawn a second task
        for _ in range(200):
            if not old.exists():
                break
            await asyncio.sleep(0.01)

        assert not old.exists()
        assert recent.exists()
        await retention.aclose()
        assert retention._task is None
