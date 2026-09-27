"""Regression tests: Spider must never link to, or scan, raw captures.

``AgentRunner.run_pipeline`` holds the capture's (non-reentrant) path lock
for the whole run. A capture is usually the note most similar to the one
Weaver files from it, so Spider used to pick it as a link target; writing
the backlink then waited on the lock the pipeline already held, and the run
never returned. With one background worker, that stopped all Inbox
processing until a restart.
"""

import asyncio
from pathlib import Path

import pytest

from agents.loom.scribe import init_scribe
from agents.loom.sentinel import init_sentinel
from agents.loom.spider import Spider, init_spider
from agents.loom.spider_lookup import (
    build_title_map,
    is_link_candidate,
    list_vault_notes,
    resolve_title,
)
from agents.loom.weaver import init_weaver
from agents.runner import init_runner
from core.note_index import get_note_index
from index import searcher as searcher_mod
from tests.test_agent_pipeline import _build_vault, _write_capture
from tests.test_pipeline_idempotency import _scaffold_all_agents
from tests.test_spider_archive_links import _meta, _setup_vault, _write_note


def test_is_link_candidate_rejects_captures_and_archive(tmp_path: Path) -> None:
    threads = tmp_path / "threads"
    assert is_link_candidate(threads / "topics" / "note.md")
    assert not is_link_candidate(threads / "captures" / "raw.md")
    assert not is_link_candidate(threads / ".archive" / "old.md")


@pytest.mark.parametrize("use_index", [True, False], ids=["index", "disk"])
def test_lookups_exclude_captures(tmp_path: Path, use_index: bool) -> None:
    root = _setup_vault(tmp_path)
    threads_dir = root / "threads"
    filed = _write_note(
        root, "topics", "parser.md", _meta("thr_note01", "Parser", ["loom"]), "Filed.\n"
    )
    # Same title as the note filed from it, as the pipeline usually produces.
    _write_note(
        root,
        "captures",
        "parser.md",
        _meta("thr_capt01", "Parser", ["loom"], "capture"),
        "Raw capture.\n",
    )
    if use_index:
        get_note_index().build(threads_dir)

    assert resolve_title(root, "thr_capt01") == ""
    assert resolve_title(root, "thr_note01") == "Parser"
    # The capture must not shadow the filed note that shares its title.
    assert build_title_map(threads_dir) == {"parser": filed}
    assert {n["id"] for n in list_vault_notes(threads_dir)} == {"thr_note01"}


def test_vault_scan_skips_captures(tmp_path: Path) -> None:
    root = _setup_vault(tmp_path)
    note = _write_note(root, "topics", "a.md", _meta("thr_a00001", "A", ["x"]), "A.\n")
    _write_note(root, "captures", "b.md", _meta("thr_b00001", "B", ["x"], "capture"), "B.\n")

    assert Spider(root)._iter_vault_notes() == [note]


@pytest.mark.asyncio
async def test_pipeline_does_not_deadlock_linking_back_to_its_capture(tmp_path: Path) -> None:
    root = _build_vault(tmp_path)
    _scaffold_all_agents(root)
    (root / "threads" / "daily").mkdir(parents=True, exist_ok=True)
    capture = _write_capture(
        root,
        "standup-2026-09-27.md",
        "Standup 2026-09-27",
        "Standup recap: today we shipped the parser.\n",
    )
    # Tagged like a Standup capture, so tag overlap makes the capture the
    # best link candidate for the note filed from it.
    capture.write_text(capture.read_text().replace("- inbox", "- daily"))
    searcher_mod.reset_searcher()
    get_note_index().build(root / "threads")
    for init in (init_weaver, init_spider, init_scribe, init_sentinel):
        init(root, None)
    runner = init_runner(root)

    await asyncio.wait_for(runner.run_pipeline(capture), timeout=10)

    captures_after = list((root / "threads" / "captures").glob("*.md"))
    for path in captures_after:
        assert "Spider added backlink" not in path.read_text()
