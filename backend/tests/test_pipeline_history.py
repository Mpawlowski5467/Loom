"""A full capture pipeline run lands in vault history as one Sentinel-stamped commit."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest

from agents.loom.scribe import init_scribe
from agents.loom.sentinel import init_sentinel
from agents.loom.spider import init_spider
from agents.loom.weaver import init_weaver
from agents.runner import init_runner
from core.history import start_history, stop_history
from core.history.git import git_available
from core.history.messages import parse_trailers
from core.note_index import get_note_index
from tests.test_agent_pipeline import _build_vault, _write_capture
from tests.test_pipeline_e2e import _stub_chat
from tests.test_pipeline_idempotency import _scaffold_all_agents

pytestmark = pytest.mark.skipif(not git_available(), reason="git is not installed")


@pytest.fixture(autouse=True)
def _isolated_index() -> Iterator[None]:
    from core import note_index as ni_mod

    previous = ni_mod._note_index
    ni_mod._note_index = None
    yield
    stop_history()
    ni_mod._note_index = previous


@pytest.mark.asyncio
async def test_pipeline_run_is_one_commit_with_sentinel_verdict(tmp_path: Path) -> None:
    root = _build_vault(tmp_path)
    _scaffold_all_agents(root)
    capture_path = _write_capture(root, "cap-raft.md", "Raft notes", "Notes on Raft.\n")
    history = start_history(root)
    assert history is not None
    history.flush()
    before = len(history.repo.log(limit=100))

    get_note_index().build(root / "threads")
    init_weaver(root, _stub_chat())
    init_spider(root, None)
    init_scribe(root, None)
    init_sentinel(root, None)
    result = await init_runner(root).run_pipeline(capture_path)
    assert result.success, result.errors
    history.flush()

    log = history.repo.log(limit=100)
    assert len(log) == before + 1, [e.message.splitlines()[0] for e in log]
    head = log[0]
    trailers = parse_trailers(head.message)
    assert head.message.startswith("weaver: ")
    assert "weaver" in trailers["Agent"]
    assert trailers["Sentinel"][0].split()[0] in {"passed", "warning"}
    assert trailers["Loom-Run"][0]
    assert any(path.startswith("threads/topics/") for path in head.files)
    assert history.repo.status_entries() == []
