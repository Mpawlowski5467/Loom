"""Path-safety helpers shared by note archive and restore operations."""

from __future__ import annotations

from pathlib import Path

ARCHIVE_ORIGINAL_PATH_FIELD = "archive_original_path"


class ArchivePathError(ValueError):
    """Raised when an archive or restore path is not safe to use."""


def validate_relative_note_path(value: object) -> Path:
    """Return a validated note path relative to ``threads/``.

    Archive metadata is persisted on disk and can therefore be edited outside
    Loom. Treat it as untrusted input: absolute paths, traversal, the reserved
    archive directory, and non-Markdown targets are all rejected.
    """
    if not isinstance(value, (str, Path)):
        raise ArchivePathError("Archived note path must be a string")

    raw = str(value)
    if not raw or "\x00" in raw:
        raise ArchivePathError("Archived note path is empty or invalid")

    rel = Path(raw)
    if rel.is_absolute():
        raise ArchivePathError("Archived note path must be relative to threads/")
    if not rel.parts or any(part in {"", ".", ".."} for part in rel.parts):
        raise ArchivePathError("Archived note path contains traversal")
    if any(part.casefold() == ".archive" for part in rel.parts):
        raise ArchivePathError("Archived note path targets the reserved archive directory")
    if rel.suffix != ".md":
        raise ArchivePathError("Archived note path must end in .md")
    return rel


def relative_existing_note_path(root: Path, note_path: Path) -> Path:
    """Return ``note_path`` relative to ``root`` without following symlinks.

    The returned path is suitable for durable archive metadata. Every
    component below ``root`` must be a real directory/file rather than a
    symlink, and the resolved file must remain contained by the resolved root.
    """
    root_abs = root.absolute()
    path_abs = note_path.absolute()
    try:
        rel = validate_relative_note_path(path_abs.relative_to(root_abs))
    except ValueError as exc:
        raise ArchivePathError(f"Note path is outside {root}") from exc

    current = root_abs
    for part in rel.parts:
        current = current / part
        if current.is_symlink():
            raise ArchivePathError(f"Symbolic links are not allowed in note paths: {current}")

    try:
        root_resolved = root_abs.resolve(strict=True)
        path_resolved = path_abs.resolve(strict=True)
        path_resolved.relative_to(root_resolved)
    except (OSError, ValueError) as exc:
        raise ArchivePathError(f"Note path is outside {root}") from exc

    if not path_resolved.is_file():
        raise ArchivePathError(f"Note path is not a regular file: {note_path}")
    return rel


def archive_directory(threads_dir: Path, *, create: bool) -> Path | None:
    """Return a validated, non-symlink ``threads/.archive`` directory."""
    try:
        threads_root = threads_dir.resolve(strict=True)
    except OSError as exc:
        raise ArchivePathError(f"Cannot resolve the vault threads directory: {exc}") from exc

    candidate = threads_root / ".archive"
    if create:
        try:
            candidate.mkdir(exist_ok=True)
        except OSError as exc:
            raise ArchivePathError(f"Cannot create the note archive: {exc}") from exc
    elif not candidate.exists() and not candidate.is_symlink():
        return None

    if candidate.is_symlink():
        raise ArchivePathError("The note archive cannot be a symbolic link")
    if not candidate.is_dir():
        raise ArchivePathError("The note archive path is not a directory")

    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(threads_root)
    except (OSError, ValueError) as exc:
        raise ArchivePathError("The note archive is outside the active vault") from exc
    return resolved


def safe_note_destination(root: Path, relative_path: object) -> Path:
    """Create safe parent directories and return a contained note target.

    Existing parent components must be real directories, not symlinks. Newly
    created components are revalidated before descending into them. The
    returned parent is resolved, so later writes do not traverse an unchecked
    lexical path.
    """
    rel = validate_relative_note_path(relative_path)
    try:
        root_resolved = root.resolve(strict=True)
    except OSError as exc:
        raise ArchivePathError(f"Cannot resolve destination root: {exc}") from exc

    current = root_resolved
    for part in rel.parent.parts:
        if part == ".":
            continue
        candidate = current / part
        try:
            candidate.mkdir(exist_ok=True)
        except OSError as exc:
            raise ArchivePathError(f"Cannot create archive directory {candidate}: {exc}") from exc
        if candidate.is_symlink():
            raise ArchivePathError(f"Symbolic links are not allowed in note paths: {candidate}")
        if not candidate.is_dir():
            raise ArchivePathError(f"Note path parent is not a directory: {candidate}")
        try:
            resolved = candidate.resolve(strict=True)
            resolved.relative_to(root_resolved)
        except (OSError, ValueError) as exc:
            raise ArchivePathError(f"Note path parent is outside {root}") from exc
        current = resolved

    return current / rel.name
