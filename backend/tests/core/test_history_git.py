"""GitRepo: exact-content commits, private indexes, log filtering, three-way merge."""

import subprocess
from pathlib import Path

import pytest

from core.history.git import GitRepo, Identity, git_available

pytestmark = pytest.mark.skipif(not git_available(), reason="git is not installed")
WHO = Identity(name="weaver", email="weaver@loom.invalid")


@pytest.fixture()
def repo(tmp_path: Path) -> GitRepo:
    repo = GitRepo(tmp_path)
    repo.init()
    return repo


def test_commit_changes_records_exact_bytes_not_disk(repo: GitRepo, tmp_path: Path) -> None:
    (tmp_path / "threads").mkdir()
    (tmp_path / "threads" / "a.md").write_text("edited later on disk\n")
    sha = repo.commit_changes(
        {"threads/a.md": b"what the agent wrote\n"}, "weaver: created a\n", WHO
    )
    assert sha is not None
    assert repo.blob(sha, "threads/a.md") == b"what the agent wrote\n"
    # The newer disk content is still an uncommitted change.
    assert [p for _, p in repo.status_entries()] == ["threads/a.md"]


def test_identical_commit_is_a_noop(repo: GitRepo) -> None:
    first = repo.commit_changes({"threads/a.md": b"x\n"}, "one\n", WHO)
    assert repo.commit_changes({"threads/a.md": b"x\n"}, "two\n", WHO) is None
    assert repo.head() == first


def test_mirrored_index_keeps_status_clean(repo: GitRepo, tmp_path: Path) -> None:
    (tmp_path / "threads").mkdir()
    (tmp_path / "threads" / "a.md").write_bytes(b"same\n")
    repo.commit_changes({"threads/a.md": b"same\n"}, "weaver: created a\n", WHO)
    assert repo.status_entries() == []


def test_user_staged_changes_are_never_swept_in(repo: GitRepo, tmp_path: Path) -> None:
    (tmp_path / "mine.txt").write_text("staged by the user\n")
    repo.run("add", "mine.txt")
    sha = repo.commit_changes({"threads/a.md": b"agent\n"}, "weaver: created a\n", WHO)
    assert sha is not None
    assert repo.blob(sha, "mine.txt") is None


def test_deletion_and_worktree_commit(repo: GitRepo, tmp_path: Path) -> None:
    repo.commit_changes({"threads/a.md": b"a\n", "threads/b.md": b"b\n"}, "seed\n", WHO)
    sha = repo.commit_changes({"threads/a.md": None}, "weaver: deleted a\n", WHO)
    assert sha is not None and repo.blob(sha, "threads/a.md") is None
    (tmp_path / "threads").mkdir(exist_ok=True)
    (tmp_path / "threads" / "b.md").write_text("b edited\n")
    (tmp_path / "threads" / "c [draft].md").write_text("new\n")  # glob chars stay literal
    paths = [p for _, p in repo.status_entries()]
    sha2 = repo.commit_worktree(paths, "human: edited\n", WHO)
    assert repo.blob(sha2 or "", "threads/c [draft].md") == b"new\n"
    assert repo.blob(sha2 or "", "threads/b.md") == b"b edited\n"


def test_log_filters_by_trailer_and_path(repo: GitRepo) -> None:
    repo.commit_changes({"threads/a.md": b"1\n"}, "weaver: created a\n\nAgent: weaver\n", WHO)
    repo.commit_changes({"threads/b.md": b"1\n"}, "spider: linked b\n\nAgent: spider\n", WHO)
    spider = repo.log(greps=["^Agent: spider$"])
    assert [e.message.splitlines()[0] for e in spider] == ["spider: linked b"]
    only_a = repo.log(path="threads/a.md")
    assert [e.files for e in only_a] == [["threads/a.md"]]


def test_commits_skip_hooks_and_signing(repo: GitRepo, tmp_path: Path) -> None:
    hook = tmp_path / ".git" / "hooks" / "pre-commit"
    hook.write_text("#!/bin/sh\ntouch hook-ran\nexit 1\n")
    hook.chmod(0o755)
    repo.run("config", "commit.gpgsign", "true")
    assert repo.commit_changes({"threads/a.md": b"x\n"}, "weaver: created a\n", WHO)
    assert not (tmp_path / "hook-ran").exists()


def test_merge_file_reports_clean_and_conflicting_merges(repo: GitRepo) -> None:
    # Undo a line-1 change while keeping a later, unrelated line-5 change.
    merged, clean = repo.merge_file(
        current=b"A\nb\nc\nd\nE\n", base=b"A\nb\nc\nd\ne\n", other=b"a\nb\nc\nd\ne\n"
    )
    assert clean
    assert merged == b"a\nb\nc\nd\nE\n"
    _, clean = repo.merge_file(current=b"a\nX\nc\n", base=b"a\nY\nc\n", other=b"a\nb\nc\n")
    assert not clean


def test_vault_repo_is_independent_of_an_enclosing_repo(tmp_path: Path) -> None:
    outer = tmp_path / "outer"
    outer.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=outer, check=True)
    vault = outer / "vault"
    vault.mkdir()
    repo = GitRepo(vault)
    assert not repo.is_repo()
    repo.init()
    repo.commit_changes({"threads/a.md": b"x\n"}, "weaver: created a\n", WHO)
    assert (vault / ".git").is_dir()
    assert GitRepo(outer).head() is None
