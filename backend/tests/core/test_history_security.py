"""A vault's own git config must never make Loom run commands.

Covers config-driven command hooks (fsmonitor, clean filters, textconv,
external diff, repository hooks) and vault archives that smuggle a ``.git``
directory in through import.
"""

import io
import os
import tarfile
from pathlib import Path

import pytest

from core.history import start_history, stop_history
from core.history.git import GitRepo, Identity, git_available

pytestmark = [
    pytest.mark.skipif(not git_available(), reason="git is not installed"),
    pytest.mark.skipif(os.name == "nt", reason="payloads are POSIX shell commands"),
]
WHO = Identity(name="weaver", email="weaver@loom.invalid")


def _hostile_config(marker: Path) -> str:
    cmd = f"touch {marker.as_posix()}"
    return (
        "[core]\n"
        "\trepositoryformatversion = 0\n"
        "\tbare = false\n"
        f'\tfsmonitor = "{cmd}; false"\n'
        f"\thooksPath = hooks-dir\n"
        '[filter "evil"]\n'
        f'\tclean = "{cmd}; cat"\n'
        f'\tsmudge = "{cmd}; cat"\n'
        "\trequired = true\n"
        '[diff "evil"]\n'
        f'\ttextconv = "{cmd}; cat"\n'
        f'\tcommand = "{cmd}"\n'
        "[diff]\n"
        f'\texternal = "{cmd}"\n'
    )


def _arm(root: Path, marker: Path) -> None:
    """Turn an existing repo at ``root`` hostile: config, attributes, and hooks."""
    (root / ".git" / "config").write_text(_hostile_config(marker))
    (root / ".gitattributes").write_text("* filter=evil diff=evil\n")
    for hooks in (root / ".git" / "hooks", root / "hooks-dir"):
        hooks.mkdir(exist_ok=True)
        for name in ("reference-transaction", "post-index-change", "pre-commit"):
            hook = hooks / name
            hook.write_text(f"#!/bin/sh\ntouch {marker.as_posix()}\n")
            hook.chmod(0o755)


def test_repo_config_commands_never_run(tmp_path: Path) -> None:
    vault, marker = tmp_path / "vault", tmp_path / "pwned"
    vault.mkdir()
    repo = GitRepo(vault)
    repo.init()
    repo.commit_changes({"threads/a.md": b"one\n"}, "seed\n", WHO)
    _arm(vault, marker)
    (vault / "threads").mkdir(exist_ok=True)
    (vault / "threads" / "a.md").write_text("two\n")
    (vault / "threads" / "b.md").write_text("new\n")

    paths = [p for _, p in repo.status_entries()]
    sha = repo.commit_worktree(paths, "human: edited\n", WHO)
    assert sha is not None
    repo.commit_changes({"threads/c.md": b"agent\n"}, "weaver: created c\n", WHO)
    repo.patch(sha)
    repo.changed_files(sha)
    repo.log(path="threads/a.md")
    repo.log(limit=5)

    assert not marker.exists()
    # No clean filter ran: the committed bytes are the file's bytes.
    assert repo.blob(sha, "threads/a.md") == b"two\n"


def _hostile_archive(tmp_path: Path, marker: Path) -> Path:
    archive = tmp_path / "vault.tar.gz"
    files = {
        "evil/vault.yaml": "name: evil\n",
        "evil/threads/topics/a.md": "---\nid: a\ntitle: A\n---\nbody\n",
        "evil/.gitattributes": "* filter=evil diff=evil\n",
        "evil/.git/HEAD": "ref: refs/heads/main\n",
        "evil/.git/config": _hostile_config(marker),
        "evil/threads/.GIT/config": _hostile_config(marker),
    }
    with tarfile.open(archive, "w:gz") as tar:
        for name, text in files.items():
            data = text.encode()
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return archive


def test_import_strips_git_metadata_and_history_stays_inert(tmp_path: Path) -> None:
    from api.routers import vaults as vault_routes

    marker = tmp_path / "pwned"
    vaults_dir = tmp_path / "vaults"
    dest = vaults_dir / "evil"
    vault_routes._restore_tarball(
        _hostile_archive(tmp_path, marker), dest, vaults_dir, overwrite=False
    )
    assert not (dest / ".git").exists()
    assert not (dest / "threads" / ".GIT").exists()
    assert (dest / "threads" / "topics" / "a.md").is_file()

    try:
        recorder = start_history(dest)
        assert recorder is not None
        recorder.flush()
        (dest / "threads" / "topics" / "a.md").write_text("edited\n")
        recorder.submit(lambda: recorder.sweep_now("test")).result(10)
    finally:
        stop_history()
    assert not marker.exists()


def test_history_on_a_preexisting_hostile_repo_runs_nothing(tmp_path: Path) -> None:
    vault, marker = tmp_path / "vault", tmp_path / "pwned"
    (vault / "threads").mkdir(parents=True)
    (vault / "vault.yaml").write_text("name: vault\n")
    GitRepo(vault).init()
    _arm(vault, marker)
    (vault / "threads" / "a.md").write_text("note\n")
    try:
        recorder = start_history(vault)
        assert recorder is not None
        recorder.flush()
        assert recorder.repo.head() is not None
    finally:
        stop_history()
    assert not marker.exists()
