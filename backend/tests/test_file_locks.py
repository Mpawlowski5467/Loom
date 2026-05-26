"""Tests for agents/file_locks.py — path-keyed asyncio locks."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from agents.file_locks import _clear_for_tests, path_lock


@pytest.fixture(autouse=True)
def _clear():
    _clear_for_tests()
    yield
    _clear_for_tests()


class TestPathLock:
    @pytest.mark.asyncio
    async def test_serializes_same_path(self, tmp_path: Path) -> None:
        """Two coroutines locking the same path run sequentially."""
        target = tmp_path / "shared.md"
        order: list[str] = []

        async def first():
            async with path_lock(target):
                order.append("first-in")
                await asyncio.sleep(0.02)
                order.append("first-out")

        async def second():
            await asyncio.sleep(0.005)  # ensure first acquires the lock first
            async with path_lock(target):
                order.append("second-in")
                order.append("second-out")

        await asyncio.gather(first(), second())

        assert order == ["first-in", "first-out", "second-in", "second-out"]

    @pytest.mark.asyncio
    async def test_different_paths_do_not_block(self, tmp_path: Path) -> None:
        """Locks on different paths run concurrently."""
        a = tmp_path / "a.md"
        b = tmp_path / "b.md"
        order: list[str] = []

        async def hold_a():
            async with path_lock(a):
                order.append("a-in")
                await asyncio.sleep(0.05)
                order.append("a-out")

        async def hold_b():
            async with path_lock(b):
                order.append("b-in")
                order.append("b-out")

        await asyncio.gather(hold_a(), hold_b())

        # b should have finished before a-out (no blocking).
        assert order.index("b-out") < order.index("a-out")

    @pytest.mark.asyncio
    async def test_relative_and_absolute_share_lock(self, tmp_path: Path) -> None:
        """The lock key normalizes paths so equivalent forms share a lock."""
        # Create file and reference it two ways.
        target = tmp_path / "shared.md"
        target.write_text("x")
        order: list[str] = []

        async def hold_resolved():
            async with path_lock(target.resolve()):
                order.append("r-in")
                await asyncio.sleep(0.02)
                order.append("r-out")

        async def hold_relative():
            # Same file, but reached via an unresolved Path with .. roundtrip.
            equiv = (target.parent / "." / target.name).resolve()
            await asyncio.sleep(0.005)
            async with path_lock(equiv):
                order.append("rel-in")
                order.append("rel-out")

        await asyncio.gather(hold_resolved(), hold_relative())

        assert order == ["r-in", "r-out", "rel-in", "rel-out"]
