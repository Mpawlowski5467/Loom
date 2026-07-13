"""Idempotency tests for AgentRunner.run_pipeline.

A crash between note creation and capture archiving must not produce a
duplicate note on re-run. The pipeline keys dedup on the capture's stable id
(``source == capture:<id>``), finds the already-written note, and finishes the
interrupted archive instead of re-creating.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
import yaml

from agents.loom.weaver import init_weaver
from agents.runner import init_runner
from core.note_index import get_note_index
from core.notes import parse_note_meta

# Reuse the vault scaffold from the Weaver pipeline tests.
from tests.test_agent_pipeline import _build_vault, _write_capture


def _scaffold_all_agents(root: Path) -> None:
    """Create dirs/state for the agents the runner pulls beyond Weaver.

    ``_build_vault`` only sets up Weaver; Spider/Scribe/Sentinel each persist
    state + changelog under their own dir.
    """
    for name in ("spider", "scribe", "sentinel"):
        agent_dir = root / "agents" / name
        agent_dir.mkdir(parents=True, exist_ok=True)
        (agent_dir / "config.yaml").write_text(
            yaml.safe_dump(
                {"name": name, "enabled": True, "trust_level": "standard", "memory_threshold": 100}
            ),
            encoding="utf-8",
        )
        (agent_dir / "memory.md").write_text("# Memory\n", encoding="utf-8")
        (agent_dir / "state.json").write_text(
            json.dumps({"action_count": 0, "last_action": None}), encoding="utf-8"
        )
        (agent_dir / "logs").mkdir(exist_ok=True)
        (root / ".loom" / "changelog" / name).mkdir(parents=True, exist_ok=True)


def _init_runtime(root: Path):
    """Seed the singletons the runner pulls (heuristic, no LLM) + the runner."""
    from agents.loom.scribe import init_scribe
    from agents.loom.sentinel import init_sentinel
    from agents.loom.spider import init_spider

    get_note_index().build(root / "threads")
    init_weaver(root, None)
    init_spider(root, None)
    init_scribe(root, None)
    init_sentinel(root, None)
    return init_runner(root)


def _notes_with_capture_source(root: Path, capture_id: str) -> list[Path]:
    """All note files under threads/ (excluding archive) sourced from a capture."""
    target = f"capture:{capture_id}"
    hits: list[Path] = []
    for md in (root / "threads").rglob("*.md"):
        if ".archive" in md.parts:
            continue
        try:
            if parse_note_meta(md).source == target:
                hits.append(md)
        except (OSError, ValueError):
            continue
    return hits


@pytest.fixture(autouse=True)
def _reset_note_index():
    """Isolate the module-level NoteIndex per test."""
    from core import note_index as ni_mod

    prev = ni_mod._note_index
    ni_mod._note_index = None
    yield
    ni_mod._note_index = None
    ni_mod._note_index = prev


class TestPipelineIdempotency:
    @pytest.mark.asyncio
    async def test_concurrent_same_capture_runs_create_one_note(self, tmp_path: Path) -> None:
        """Two runners racing the same capture serialize around the full transaction."""
        root = _build_vault(tmp_path)
        _scaffold_all_agents(root)
        capture_path = _write_capture(
            root, "cap-race.md", "Race Note", "Body about concurrent pipelines.\n"
        )
        capture_id = parse_note_meta(capture_path).id
        runner_a = _init_runtime(root)

        from agents.loom.weaver import get_weaver
        from agents.runner import AgentRunner

        weaver = get_weaver()
        assert weaver is not None
        original = weaver.process_capture_full
        entered = asyncio.Event()
        release = asyncio.Event()
        calls = 0

        async def gated_process(path: Path):
            nonlocal calls
            calls += 1
            entered.set()
            await release.wait()
            return await original(path)

        weaver.process_capture_full = gated_process  # type: ignore[method-assign]
        runner_b = AgentRunner(root)

        first = asyncio.create_task(
            runner_a.run_pipeline(capture_path, refresh_index=get_note_index().refresh_file)
        )
        await entered.wait()
        second = asyncio.create_task(
            runner_b.run_pipeline(capture_path, refresh_index=get_note_index().refresh_file)
        )
        await asyncio.sleep(0)
        release.set()
        result_a, result_b = await asyncio.gather(first, second)

        assert calls == 1
        assert sum(result.note is not None for result in (result_a, result_b)) == 1
        assert sum(result.capture_archived for result in (result_a, result_b)) == 1
        assert not capture_path.exists()
        assert len(_notes_with_capture_source(root, capture_id)) == 1

    @pytest.mark.asyncio
    async def test_archive_crash_then_retry_creates_no_duplicate(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A crash in the archive step leaves the capture; the retry finishes it."""
        root = _build_vault(tmp_path)
        _scaffold_all_agents(root)
        capture_path = _write_capture(
            root, "cap-idem.md", "Idempotency Note", "Body about idempotent pipelines.\n"
        )
        capture_id = parse_note_meta(capture_path).id

        runner = _init_runtime(root)

        # --- Run 1: simulate a crash during archiving. ---
        import agents.loom.weaver_io as weaver_io

        real_archive = weaver_io.archive_capture
        calls = {"n": 0}

        def _flaky_archive(*args, **kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("simulated crash during archive")
            return real_archive(*args, **kwargs)

        monkeypatch.setattr(weaver_io, "archive_capture", _flaky_archive)

        result1 = await runner.run_pipeline(capture_path)

        # Note was written, but archive failed → capture still present.
        assert result1.note is not None
        assert result1.capture_archived is False
        assert capture_path.exists()
        assert len(_notes_with_capture_source(root, capture_id)) == 1

        # The watcher would refresh the index after the note write; simulate it.
        get_note_index().build(root / "threads")

        # --- Run 2: retry. Archive now succeeds. ---
        result2 = await runner.run_pipeline(capture_path)

        assert result2.note is not None
        assert result2.note.id == result1.note.id  # same note, not a new one
        assert result2.capture_archived is True
        assert not capture_path.exists()  # moved to .archive
        # Still exactly one note from this capture (no duplicate).
        assert len(_notes_with_capture_source(root, capture_id)) == 1
        # And it landed in the archive.
        archived = list((root / "threads" / ".archive").glob("*.md"))
        assert len(archived) == 1

    @pytest.mark.asyncio
    async def test_missing_capture_is_noop(self, tmp_path: Path) -> None:
        """Re-running on an already-archived (absent) capture does nothing."""
        root = _build_vault(tmp_path)
        _scaffold_all_agents(root)
        runner = _init_runtime(root)

        missing = root / "threads" / "captures" / "gone.md"
        result = await runner.run_pipeline(missing)

        assert result.note is None
        assert result.capture_archived is False
        assert result.errors == []

    @pytest.mark.asyncio
    async def test_clean_run_then_rerun_after_index_refresh(self, tmp_path: Path) -> None:
        """A clean run archives; a (hypothetical) re-run finds no duplicate."""
        root = _build_vault(tmp_path)
        _scaffold_all_agents(root)
        capture_path = _write_capture(
            root, "cap-clean.md", "Clean Note", "Body for a clean pipeline run.\n"
        )
        capture_id = parse_note_meta(capture_path).id
        runner = _init_runtime(root)

        result = await runner.run_pipeline(capture_path)

        assert result.capture_archived is True
        assert not capture_path.exists()
        assert len(_notes_with_capture_source(root, capture_id)) == 1
