"""Reverting history commits: new revert commits, Sentinel gating, archiving, conflicts."""

import asyncio
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from core.history import VaultHistory, commit_group
from core.history.messages import parse_trailers
from core.history.revert import RevertError, RevertRejected, revert_commit
from core.note_index import get_note_index
from core.vault_io import write_note
from tests.core.conftest import note_meta, requires_git, set_history_config

pytestmark = requires_git


@pytest.fixture(autouse=True)
def sentinel(vault_root: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    import agents.loom.sentinel as sentinel_mod

    monkeypatch.setattr(sentinel_mod, "_sentinel", None)
    sentinel_mod.init_sentinel(vault_root, None)
    yield


def _write(history: VaultHistory, root: Path, rel: str, meta: dict[str, Any], body: str) -> str:
    async def run() -> None:
        async with commit_group():
            write_note(root, root / "threads" / rel, meta, body)

    asyncio.run(run())
    history.flush()
    return history.repo.log(limit=1)[0].sha


def _revert(history: VaultHistory, sha: str) -> dict[str, Any]:
    async def run() -> dict[str, Any]:
        return await revert_commit(history, sha)

    result = asyncio.run(run())
    history.flush()
    return result


def _updated(note_id: str, title: str) -> dict[str, Any]:
    meta = note_meta(note_id, title)
    meta["history"].append(
        {
            "action": "updated",
            "by": "agent:spider",
            "at": "2026-01-03T00:00:00+00:00",
            "reason": "Linked",
        }
    )
    return meta


def test_revert_restores_content_with_a_new_commit(history: VaultHistory, vault_root: Path) -> None:
    _write(history, vault_root, "topics/raft.md", note_meta("n1", "Raft"), "Original body\n")
    original = (vault_root / "threads/topics/raft.md").read_text()
    change = _write(
        history, vault_root, "topics/raft.md", _updated("n1", "Raft"), "Spider rewrote this\n"
    )

    result = _revert(history, change)

    assert (vault_root / "threads/topics/raft.md").read_text() == original
    head = history.repo.log(limit=1)[0]
    assert head.sha == result["sha"]
    assert head.message.startswith('Revert "spider: updated threads/topics/raft.md"')
    assert f"This reverts commit {change}." in head.message
    trailers = parse_trailers(head.message)
    assert trailers["Agent"] == ["human"]
    assert trailers["Action"] == ["revert"]
    assert trailers["Reverts"] == [change]
    assert trailers["Sentinel"][0] in {"passed", "warning"}
    assert change in [e.sha for e in history.repo.log(limit=10)]  # history kept


def test_reverting_a_creation_archives_the_note(history: VaultHistory, vault_root: Path) -> None:
    created = _write(history, vault_root, "topics/new.md", note_meta("n2", "New"), "Fresh\n")
    _revert(history, created)
    assert not (vault_root / "threads/topics/new.md").exists()
    archived = vault_root / "threads" / ".archive" / f"revert-{created[:10]}" / "topics" / "new.md"
    assert "status: archived" in archived.read_text()


def test_overlapping_later_edit_conflicts_and_changes_nothing(
    history: VaultHistory, vault_root: Path
) -> None:
    _write(history, vault_root, "topics/a.md", note_meta("a", "A"), "line one\n")
    change = _write(history, vault_root, "topics/a.md", _updated("a", "A"), "line one by spider\n")
    path = vault_root / "threads/topics/a.md"
    path.write_text(path.read_text().replace("line one by spider", "line one by me"))
    with pytest.raises(RevertError) as excinfo:
        _revert(history, change)
    assert excinfo.value.status == 409
    assert excinfo.value.paths == ["threads/topics/a.md"]
    assert "line one by me" in path.read_text()


def test_unrelated_later_edit_merges_cleanly(history: VaultHistory, vault_root: Path) -> None:
    body = "".join(f"para {i}\n\n" for i in range(8))
    _write(history, vault_root, "topics/a.md", note_meta("a", "A"), body)
    change = _write(
        history,
        vault_root,
        "topics/a.md",
        _updated("a", "A"),
        body.replace("para 7", "para 7 linked [[B]]"),
    )
    path = vault_root / "threads/topics/a.md"
    path.write_text(path.read_text().replace("para 0", "para 0 (my note)"))
    _revert(history, change)
    text = path.read_text()
    assert "para 0 (my note)" in text and "[[B]]" not in text


def test_sentinel_can_block_a_revert(history: VaultHistory, vault_root: Path) -> None:
    set_history_config(vault_root, revert_block_on="warning")
    history.config.revert_block_on = "warning"
    sloppy = note_meta("s", "S")
    del sloppy["tags"]  # missing required field → Sentinel warning
    _write(history, vault_root, "topics/s.md", sloppy, "x\n")
    change = _write(history, vault_root, "topics/s.md", _updated("s", "S"), "fixed by spider\n")
    with pytest.raises(RevertRejected) as excinfo:
        _revert(history, change)
    assert excinfo.value.status == 422
    assert "fixed by spider" in (vault_root / "threads/topics/s.md").read_text()


def test_snapshot_and_non_note_commits_are_refused(history: VaultHistory, vault_root: Path) -> None:
    snapshot = history.repo.log(limit=1)[0].sha
    with pytest.raises(RevertRejected):
        _revert(history, snapshot)
    (vault_root / "rules" / "prime.md").write_text("edited constitution\n")
    rules_commit = history.submit(lambda: history.sweep_now("test")).result(10)
    with pytest.raises(RevertRejected) as excinfo:
        _revert(history, rules_commit or "")
    assert excinfo.value.paths == ["rules/prime.md"]


def test_unknown_commit_is_not_found(history: VaultHistory) -> None:
    with pytest.raises(RevertError) as excinfo:
        _revert(history, "deadbeef")
    assert excinfo.value.status == 404


def test_revert_refreshes_the_note_index(history: VaultHistory, vault_root: Path) -> None:
    _write(history, vault_root, "topics/t.md", note_meta("t", "Old title"), "x\n")
    change = _write(history, vault_root, "topics/t.md", _updated("t", "New title"), "x\n")
    index = get_note_index()
    index.build(vault_root / "threads")
    _revert(history, change)
    entry = index.get_by_path(vault_root / "threads/topics/t.md")
    assert entry is not None and entry.title == "Old title"
