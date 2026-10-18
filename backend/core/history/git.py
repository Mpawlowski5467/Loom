"""Typed wrapper over the git CLI for vault history.

Loom drives git through plumbing commands so that:

- a commit records exactly the bytes a write produced, never whatever happens
  to be on disk by the time the commit runs;
- repository hooks and commit signing never run on Loom's behalf;
- a user's own staged changes in the vault repo are never swept into a commit
  (every commit is built in a private, temporary index).
"""

from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import tempfile
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

ZERO_SHA = "0" * 40
_TIMEOUT_SECONDS = 60
# Inherited variables could point git at another repo or inject config/programs.
_STRIPPED_ENV = (
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_EXTERNAL_DIFF",
    "GIT_CONFIG_PARAMETERS",
    "GIT_CONFIG_COUNT",
    "GIT_ATTR_SOURCE",
)
_GIT_ENV = {
    "GIT_TERMINAL_PROMPT": "0",
    "GIT_LITERAL_PATHSPECS": "1",
    "GIT_CONFIG_NOSYSTEM": "1",
    "LC_ALL": "C",
}
# A vault's own git config is untrusted (a vault folder can come from anywhere),
# so every command overrides each setting that would make git run a program.
# Command-line config outranks every config file, including includes.
_SAFE_CONFIG = (
    "core.fsmonitor=false",
    f"core.hooksPath={os.devnull}",
    "core.quotepath=off",
    "core.autocrlf=false",
    "log.showSignature=false",
    "protocol.allow=never",
    "safe.bareRepository=explicit",
)
# Filter drivers and content conversions are chosen by attributes, which the
# vault's files can set. This block goes last in $GIT_DIR/info/attributes,
# which outranks every .gitattributes, so no clean/smudge/process filter runs
# and committed bytes are exactly the bytes on disk.
_ATTRIBUTES_BEGIN = "# >>> loom: neutral attributes (managed) >>>"
_ATTRIBUTES_END = "# <<< loom: neutral attributes <<<"
_NEUTRAL_ATTRIBUTES = "* -filter -text -ident -working-tree-encoding"
# Diff drivers can name textconv/external-diff programs; never use them.
_NO_DRIVERS = ("--no-textconv", "--no-ext-diff")
_RECORD_SEP = "\x1e"
_FIELD_SEP = "\x1f"


class GitError(RuntimeError):
    """A git command failed."""


class GitUnavailableError(GitError):
    """The git executable is not installed."""


def git_available() -> bool:
    """Return True when a ``git`` executable is on PATH."""
    return shutil.which("git") is not None


@dataclass(frozen=True)
class Identity:
    """Author/committer identity stamped onto a commit."""

    name: str
    email: str


@dataclass
class LogEntry:
    """One commit as listed by :meth:`GitRepo.log`."""

    sha: str
    parents: list[str]
    author: str
    date: str
    message: str
    files: list[str] = field(default_factory=list)


class GitRepo:
    """A git repository rooted at a vault directory."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self._object_format = ""
        self._attributes_neutral = False

    # -- process plumbing -------------------------------------------------

    def run(
        self,
        *args: str,
        stdin: bytes | None = None,
        env: dict[str, str] | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[bytes]:
        """Run one git command in the vault and return the completed process."""
        if not self._attributes_neutral and args[0] != "init" and self.is_repo():
            self._neutralize_attributes()
        return self._exec(args, stdin=stdin, env=env, check=check)

    def _exec(
        self,
        args: tuple[str, ...],
        *,
        stdin: bytes | None = None,
        env: dict[str, str] | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[bytes]:
        exe = shutil.which("git")
        if exe is None:
            raise GitUnavailableError("git is not installed")
        full_env = {k: v for k, v in os.environ.items() if k not in _STRIPPED_ENV}
        full_env.update(_GIT_ENV)
        full_env.update(env or {})
        config = [f"safe.directory={self.root}", *_SAFE_CONFIG]
        cmd = [exe, *(arg for item in config for arg in ("-c", item)), *args]
        try:
            proc = subprocess.run(
                cmd,
                cwd=self.root,
                input=stdin,
                capture_output=True,
                env=full_env,
                timeout=_TIMEOUT_SECONDS,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise GitError(f"git {args[0]} timed out") from exc
        if check and proc.returncode != 0:
            detail = proc.stderr.decode("utf-8", "replace").strip()
            raise GitError(f"git {args[0]} failed: {detail}")
        return proc

    def _neutralize_attributes(self) -> None:
        """Append Loom's neutral-attributes block to $GIT_DIR/info/attributes."""
        located = self._exec(("rev-parse", "--git-path", "info/attributes")).stdout
        path = self.root / located.decode("utf-8", "replace").strip()
        try:
            existing = path.read_text(encoding="utf-8") if path.exists() else ""
            block = f"{_ATTRIBUTES_BEGIN}\n{_NEUTRAL_ATTRIBUTES}\n{_ATTRIBUTES_END}\n"
            if not existing.endswith(block):
                start = existing.find(_ATTRIBUTES_BEGIN)
                end = existing.find(_ATTRIBUTES_END)
                if start != -1 and end > start:
                    existing = existing[:start] + existing[end + len(_ATTRIBUTES_END) :].lstrip(
                        "\n"
                    )
                if existing and not existing.endswith("\n"):
                    existing += "\n"
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(existing + block, encoding="utf-8")
        except OSError as exc:  # never run git on a repo we couldn't make inert
            raise GitError(f"Cannot secure vault git attributes: {exc}") from exc
        self._attributes_neutral = True

    def text(
        self, *args: str, stdin: bytes | None = None, env: dict[str, str] | None = None
    ) -> str:
        """Run a git command and return its stdout as text."""
        return self.run(*args, stdin=stdin, env=env).stdout.decode("utf-8", "replace")

    # -- repository state -------------------------------------------------

    def is_repo(self) -> bool:
        """True when the vault root itself holds a ``.git`` directory."""
        return (self.root / ".git").exists()

    def init(self) -> None:
        """Create the repository with ``main`` as its initial branch."""
        self.run("init", "-q", "--initial-branch=main")

    def head(self) -> str | None:
        """Return the HEAD commit sha, or None before the first commit."""
        return self.resolve_commit("HEAD")

    def resolve_commit(self, rev: str) -> str | None:
        """Resolve ``rev`` to a full commit sha, or None when it doesn't name one."""
        proc = self.run("rev-parse", "-q", "--verify", f"{rev}^{{commit}}", check=False)
        if proc.returncode != 0:
            return None
        return proc.stdout.decode().strip() or None

    def parents(self, sha: str) -> list[str]:
        """Return the parent shas of a commit."""
        line = self.text("rev-list", "--parents", "-n1", sha).split()
        return line[1:]

    def blob(self, rev: str, path: str) -> bytes | None:
        """Return a file's bytes at ``rev``, or None when it doesn't exist there."""
        proc = self.run("cat-file", "blob", f"{rev}:{path}", check=False)
        return proc.stdout if proc.returncode == 0 else None

    def object_id(self, data: bytes) -> str:
        """The blob id git would give ``data`` (computed locally, no subprocess)."""
        if not self._object_format:
            fmt = self.run("rev-parse", "--show-object-format", check=False).stdout
            self._object_format = fmt.decode().strip() or "sha1"
        digest = hashlib.new(self._object_format)
        digest.update(b"blob %d\0" % len(data))
        digest.update(data)
        return digest.hexdigest()

    def head_blob_ids(self, paths: set[str]) -> dict[str, str]:
        """Blob ids at HEAD for those of ``paths`` it contains."""
        if not paths or self.head() is None:
            return {}
        # Name a handful of paths directly; list the whole tree for big batches.
        scope = ["--", *sorted(paths)] if len(paths) <= 200 else []
        raw = self.run("ls-tree", "-r", "-z", "--full-tree", "HEAD", *scope).stdout.decode(
            "utf-8", "replace"
        )
        found = {}
        for entry in raw.split("\0"):
            meta, _, path = entry.partition("\t")
            if path in paths:
                found[path] = meta.split()[2]
        return found

    def status_entries(self) -> list[tuple[str, str]]:
        """``(XY, path)`` for paths whose working tree differs from HEAD (honours .gitignore)."""
        raw = self.run(
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--no-renames",
            "--ignore-submodules=all",
        ).stdout.decode("utf-8", "replace")
        entries = {entry[3:]: entry[:2] for entry in raw.split("\0") if len(entry) > 3}
        return sorted((code, path) for path, code in entries.items())

    def changed_files(self, sha: str) -> list[tuple[str, str]]:
        """``(status, path)`` pairs a commit changed relative to its first parent."""
        raw = self.text(
            "diff-tree", *_NO_DRIVERS, "-r", "--root", "--no-renames", "--name-status", "-z", sha
        )
        parts = [p for p in raw.split("\0") if p]
        if parts and parts[0] == sha:
            parts = parts[1:]
        return [(parts[i], parts[i + 1]) for i in range(0, len(parts) - 1, 2)]

    def patch(self, sha: str) -> str:
        """The unified diff a commit introduced."""
        return self.text(
            "show", *_NO_DRIVERS, "--format=", "--no-color", "--no-renames", "--patch", sha
        )

    # -- commits ----------------------------------------------------------

    def commit_changes(
        self, changes: dict[str, bytes | None], message: str, identity: Identity
    ) -> str | None:
        """Commit exact file contents (None deletes). Returns the sha, or None if no-op."""
        records = []
        for path, data in sorted(changes.items()):
            if data is None:
                records.append(f"0 {ZERO_SHA}\t{path}")
            else:
                blob = self.text("hash-object", "-w", "--stdin", stdin=data).strip()
                records.append(f"100644 {blob}\t{path}")
        info = ("\0".join(records) + "\0").encode()
        sha = self._commit_index(
            lambda env: self.run("update-index", "-z", "--index-info", stdin=info, env=env),
            message,
            identity,
        )
        if sha is not None:
            # Mirror into the user-visible index so `git status` stays clean.
            self.run("update-index", "-z", "--index-info", stdin=info, check=False)
        return sha

    def commit_worktree(self, paths: list[str], message: str, identity: Identity) -> str | None:
        """Commit the on-disk state of ``paths`` (additions, edits, deletions)."""
        spec = ("\0".join(paths) + "\0").encode()
        add = ("add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul")
        sha = self._commit_index(lambda env: self.run(*add, stdin=spec, env=env), message, identity)
        if sha is not None:
            self.run(*add, stdin=spec, check=False)
        return sha

    def _commit_index(
        self,
        stage: Callable[[dict[str, str]], object],
        message: str,
        identity: Identity,
    ) -> str | None:
        parent = self.head()
        index = self.root / ".git" / f"loom-index-{uuid.uuid4().hex}"
        env = {"GIT_INDEX_FILE": str(index)}
        try:
            self.run("read-tree", *([parent] if parent else ["--empty"]), env=env)
            stage(env)
            tree = self.text("write-tree", env=env).strip()
        finally:
            index.unlink(missing_ok=True)
        if parent and tree == self.text("rev-parse", f"{parent}^{{tree}}").strip():
            return None
        ident = {
            "GIT_AUTHOR_NAME": identity.name,
            "GIT_AUTHOR_EMAIL": identity.email,
            "GIT_COMMITTER_NAME": identity.name,
            "GIT_COMMITTER_EMAIL": identity.email,
        }
        args = ["commit-tree", "--no-gpg-sign", tree, *(["-p", parent] if parent else [])]
        sha = self.text(*args, stdin=message.encode(), env=ident).strip()
        subject = message.splitlines()[0] if message else "loom commit"
        # Compare-and-swap: fails rather than dropping a concurrent commit.
        self.run("update-ref", "-m", f"loom: {subject}", "HEAD", sha, parent or ZERO_SHA)
        return sha

    # -- reading history --------------------------------------------------

    def log(
        self, *, path: str | None = None, greps: list[str] | None = None, limit: int = 50
    ) -> list[LogEntry]:
        """List commits newest-first, optionally following one path or matching message lines."""
        if self.head() is None:
            return []
        fmt = _FIELD_SEP.join(["%H", "%P", "%an", "%aI", "%B"])
        args = [
            "log",
            *_NO_DRIVERS,
            f"-n{limit}",
            f"--format={_RECORD_SEP}{fmt}{_FIELD_SEP}",
            "--name-only",
        ]
        for pattern in greps or []:
            args.append(f"--grep={pattern}")
        if greps and len(greps) > 1:
            args.append("--all-match")
        if path:
            args += ["--follow", "--", path]
        out = self.text(*args)
        entries = []
        for record in out.split(_RECORD_SEP)[1:]:
            sha, parents, author, date, rest = record.split(_FIELD_SEP, 4)
            message, _, names = rest.rpartition(_FIELD_SEP)
            entries.append(
                LogEntry(
                    sha=sha,
                    parents=parents.split(),
                    author=author,
                    date=date,
                    message=message.strip(),
                    files=[n for n in names.splitlines() if n.strip()],
                )
            )
        return entries

    def merge_file(self, current: bytes, base: bytes, other: bytes) -> tuple[bytes, bool]:
        """Three-way merge ``base → other`` onto ``current``. Returns (result, clean)."""
        with tempfile.TemporaryDirectory(prefix="loom-merge-") as tmp:
            files = []
            for name, data in (("current", current), ("base", base), ("other", other)):
                target = Path(tmp) / name
                target.write_bytes(data)
                files.append(str(target))
            proc = self.run(
                "merge-file",
                "-p",
                "-L",
                "current",
                "-L",
                "base",
                "-L",
                "reverted",
                *files,
                check=False,
            )
        if proc.returncode < 0 or proc.returncode > 127:
            raise GitError(f"git merge-file failed: {proc.stderr.decode(errors='replace')}")
        return proc.stdout, proc.returncode == 0
