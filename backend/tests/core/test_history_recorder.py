"""Vault writes become commits: attribution, grouping, human debounce, no loops."""

import asyncio
import time
from pathlib import Path

import pytest

from core.history import (
    VaultHistory,
    commit_group,
    notify_external_change,
    set_sentinel_result,
    start_history,
    stop_history,
)
from core.history.messages import parse_trailers
from core.traces import clear_caller, set_caller
from core.vault_io import write_note
from tests.core.conftest import note_meta, requires_git, set_history_config

pytestmark = requires_git


def _subjects(history: VaultHistory) -> list[str]:
    history.flush()
    return [e.message.splitlines()[0] for e in history.repo.log(limit=50)]


def _head_trailers(history: VaultHistory) -> dict[str, list[str]]:
    history.flush()
    return parse_trailers(history.repo.log(limit=1)[0].message)


def _wait_for(predicate, timeout: float = 6.0) -> bool:  # type: ignore[no-untyped-def]
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return False


def test_start_initializes_repo_with_gitignore_and_snapshot(
    history: VaultHistory, vault_root: Path
) -> None:
    assert (vault_root / ".git").is_dir()
    ignore = (vault_root / ".gitignore").read_text()
    assert ".loom/" in ignore and "agents/" in ignore
    assert _subjects(history) == ["loom: initialize vault history"]
    tracked = history.repo.text("ls-files").splitlines()
    assert "vault.yaml" in tracked and "rules/prime.md" in tracked
    assert not any(p.startswith((".loom/", "agents/")) for p in tracked)


def test_agent_write_commits_with_subject_and_trailers(
    history: VaultHistory, vault_root: Path
) -> None:
    path = vault_root / "threads" / "topics" / "raft.md"
    write_note(vault_root, path, note_meta("n1", "Raft"), "Body\n")
    assert _subjects(history)[0] == "weaver: created threads/topics/raft.md"
    trailers = _head_trailers(history)
    assert trailers["Agent"] == ["weaver"]
    assert trailers["Action"] == ["created"]
    assert trailers["Reason"] == ["created for a test"]
    assert trailers["Sentinel"] == ["not-reviewed"]
    assert history.repo.blob("HEAD", "threads/topics/raft.md") == path.read_bytes()


def test_trace_caller_attributes_the_write(history: VaultHistory, vault_root: Path) -> None:
    set_caller("manual:spider")
    try:
        write_note(
            vault_root,
            vault_root / "threads" / "topics" / "a.md",
            note_meta("a", "A", by="user"),
            "x\n",
        )
    finally:
        clear_caller()
    assert _head_trailers(history)["Agent"] == ["spider"]


def test_group_commits_a_run_once_with_every_writer(
    history: VaultHistory, vault_root: Path
) -> None:
    async def run() -> None:
        async with commit_group(reason="Pipeline run") as group:
            group.run_id = "run_fixture"
            write_note(
                vault_root, vault_root / "threads" / "topics" / "a.md", note_meta("a", "A"), "a\n"
            )
            set_sentinel_result("passed (weaver created)")
            meta = note_meta("b", "B", by="agent:spider", action="linked")
            write_note(vault_root, vault_root / "threads" / "topics" / "b.md", meta, "[[A]]\n")
            assert history.pending_paths() == {"threads/topics/a.md", "threads/topics/b.md"}

    asyncio.run(run())
    subjects = _subjects(history)
    assert subjects[0] == "weaver: created threads/topics/a.md (+1 more)"
    assert len(subjects) == 2  # snapshot + the one grouped commit
    trailers = _head_trailers(history)
    assert trailers["Agent"] == ["weaver", "spider"]
    assert trailers["Sentinel"] == ["passed (weaver created)"]
    assert trailers["Reason"] == ["Pipeline run"]
    assert trailers["Loom-Run"] == ["run_fixture"]
    assert trailers["Loom-Group"][0].startswith("grp_")
    assert history.pending_paths() == set()


def test_nested_groups_merge_into_the_outer_commit(history: VaultHistory, vault_root: Path) -> None:
    async def run() -> None:
        async with commit_group(agent="spider", action="scan-vault"):
            for name in ("a", "b", "c"):
                async with commit_group():
                    write_note(
                        vault_root,
                        vault_root / "threads" / "topics" / f"{name}.md",
                        note_meta(name, name),
                        "x\n",
                    )

    asyncio.run(run())
    subjects = _subjects(history)
    assert subjects[0] == "spider: scan-vault threads/topics/a.md (+2 more)"
    assert len(subjects) == 2


def test_human_edits_wait_for_the_quiet_period(history: VaultHistory, vault_root: Path) -> None:
    path = vault_root / "threads" / "topics" / "mine.md"
    write_note(vault_root, path, note_meta("m", "Mine", by="user"), "draft\n")
    assert _subjects(history) == ["loom: initialize vault history"]
    assert _wait_for(lambda: len(_subjects(history)) == 2)
    assert _subjects(history)[0] == "human: created threads/topics/mine.md"
    assert _head_trailers(history)["Agent"] == ["human"]


def test_external_disk_edit_is_committed_as_human(history: VaultHistory, vault_root: Path) -> None:
    path = vault_root / "threads" / "topics" / "outside.md"
    path.write_text("edited in another app\n")
    notify_external_change(vault_root)
    assert _wait_for(lambda: len(_subjects(history)) == 2)
    assert _subjects(history)[0] == "human: created threads/topics/outside.md"


def test_own_commits_do_not_loop_through_the_watcher(
    history: VaultHistory, vault_root: Path
) -> None:
    write_note(vault_root, vault_root / "threads" / "topics" / "a.md", note_meta("a", "A"), "a\n")
    count = len(_subjects(history))
    notify_external_change(vault_root)  # what the watcher does for Loom's own write
    time.sleep(1.4)
    assert len(_subjects(history)) == count


def test_agent_commit_keeps_its_bytes_when_a_human_edits_right_after(
    history: VaultHistory, vault_root: Path
) -> None:
    async def run() -> None:
        async with commit_group():
            write_note(vault_root, path, note_meta("a", "A"), "agent text\n")
            path.write_text("human text\n")  # lands before the commit runs

    path = vault_root / "threads" / "topics" / "a.md"
    asyncio.run(run())
    history.flush()
    agent_commit = history.repo.log(limit=1)[0].sha
    assert b"agent text" in (history.repo.blob(agent_commit, "threads/topics/a.md") or b"")
    history.submit(lambda: history.sweep_now("test")).result(10)
    assert _subjects(history)[0] == "human: edited threads/topics/a.md"


def test_unsaved_human_edit_is_committed_before_an_agent_builds_on_it(
    history: VaultHistory, vault_root: Path
) -> None:
    path = vault_root / "threads" / "topics" / "mine.md"
    write_note(vault_root, path, note_meta("m", "Mine", by="user"), "my draft\n")  # debounced

    async def run() -> None:
        async with commit_group():
            meta = note_meta("m", "Mine", by="agent:spider", action="linked")
            write_note(vault_root, path, meta, "my draft\n\n[[Other]]\n")

    asyncio.run(run())
    history.flush()
    log = history.repo.log(limit=5)
    assert [e.message.splitlines()[0] for e in log[:2]] == [
        "spider: linked threads/topics/mine.md",
        "human: created threads/topics/mine.md",
    ]
    assert parse_trailers(log[1].message)["Reason"] == ["Saved before spider changed it"]
    human_version = history.repo.blob(log[1].sha, "threads/topics/mine.md") or b""
    assert b"[[Other]]" not in human_version and b"my draft" in human_version


def test_sweep_skips_paths_an_open_group_is_writing(
    history: VaultHistory, vault_root: Path
) -> None:
    async def run() -> None:
        async with commit_group():
            write_note(
                vault_root, vault_root / "threads" / "topics" / "a.md", note_meta("a", "A"), "a\n"
            )
            assert history.submit(lambda: history.sweep_now("test")).result(10) is None

    asyncio.run(run())
    assert _subjects(history)[0] == "weaver: created threads/topics/a.md"


def test_offline_edits_are_committed_on_restart(history: VaultHistory, vault_root: Path) -> None:
    stop_history()
    (vault_root / "threads" / "topics" / "offline.md").write_text("while stopped\n")
    restarted = start_history(vault_root)
    assert restarted is not None
    restarted.flush()
    head = restarted.repo.log(limit=1)[0]
    assert head.message.splitlines()[0] == "human: created threads/topics/offline.md"
    assert parse_trailers(head.message)["Reason"] == ["Changes made while Loom was not running"]


def test_disabled_history_never_creates_a_repo(vault_root: Path) -> None:
    set_history_config(vault_root, enabled=False)
    assert start_history(vault_root) is None
    write_note(vault_root, vault_root / "threads" / "topics" / "a.md", note_meta("a", "A"), "a\n")
    assert not (vault_root / ".git").exists()


def test_missing_git_disables_history(vault_root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.history.git_available", lambda: False)
    assert start_history(vault_root) is None


def test_a_failing_commit_never_fails_the_write(
    history: VaultHistory, vault_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("disk full")

    monkeypatch.setattr(history.repo, "commit_changes", boom)
    path = vault_root / "threads" / "topics" / "a.md"
    write_note(vault_root, path, note_meta("a", "A"), "a\n")
    history.flush()
    assert path.exists()
    assert "disk full" in history.last_error
