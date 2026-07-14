"""Unified capture ingress for HTTP bridges and Shuttle agents.

Every new Inbox item should take the same path: validate provenance, dedupe an
optional external key, write through the vault IO chokepoint, refresh the note
index, and create a durable processing job when policy permits.  The capture
worker's periodic filesystem reconciliation remains a recovery mechanism for
hand-written files and interrupted ingests; callers should not need to wait for
that scan during normal operation.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from pydantic import ValidationError

from core.capture_jobs import (
    CaptureJob,
    CaptureJobsBusyError,
    capture_job_store,
    get_capture_job_service,
    publish_job_change,
)
from core.config import CaptureProcessingConfig, GlobalConfig
from core.events import publish_capture_change
from core.note_index import NoteIndex, get_note_index
from core.notes import Note, generate_id, now_iso, parse_note
from core.notes_helpers import to_kebab
from core.vault_io import write_note

logger = logging.getLogger(__name__)

__all__ = [
    "CaptureIngressError",
    "CaptureIngressResult",
    "capture_processing_policy_for_vault",
    "ingest_capture",
]


class CaptureIngressError(ValueError):
    """Raised when capture input is not safe or valid for durable ingress."""


@dataclass(frozen=True, slots=True)
class CaptureIngressResult:
    """Domain result shared by the API and in-process capture producers."""

    capture: Note
    capture_path: Path
    created: bool
    deduplicated: bool
    job: CaptureJob | None = None


def capture_processing_policy_for_vault(vault_root: Path) -> CaptureProcessingConfig:
    """Load the global policy that owns a standard ``vaults/<name>`` root.

    Shuttle agents only receive a vault path, not a :class:`VaultManager`. Loom
    vaults have a stable ``<loom-home>/vaults/<name>`` layout, which lets them
    resolve the same persisted policy as HTTP requests. Ad-hoc/test vaults use
    the safe manual default instead of accidentally reading a developer's real
    home configuration.
    """
    root = vault_root.resolve()
    if root.parent.name != "vaults":
        return CaptureProcessingConfig()
    return GlobalConfig.load(root.parent.parent / "config.yaml").capture_processing


def _required_text(value: str, field: str, *, max_length: int) -> str:
    if not isinstance(value, str):
        raise CaptureIngressError(f"{field} must be text")
    normalized = value.strip()
    if not normalized:
        raise CaptureIngressError(f"{field} must not be blank")
    if len(normalized) > max_length:
        raise CaptureIngressError(f"{field} must be at most {max_length} characters")
    return normalized


def _source(value: str) -> str:
    source = _required_text(value, "source", max_length=200)
    if any(ord(char) < 32 or ord(char) == 127 for char in source):
        raise CaptureIngressError("source must be a single printable line")
    return source


def _optional_external_id(value: str | None) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise CaptureIngressError("external_id must be text")
    normalized = value.strip()
    if not normalized:
        return None
    if len(normalized) > 500:
        raise CaptureIngressError("external_id must be at most 500 characters")
    return normalized


def _string_list(
    values: list[str] | tuple[str, ...],
    field: str,
    *,
    max_items: int = 100,
    max_length: int = 100,
) -> list[str]:
    if len(values) > max_items:
        raise CaptureIngressError(f"{field} must contain at most {max_items} items")
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in values:
        if not isinstance(raw, str):
            raise CaptureIngressError(f"{field} entries must be text")
        value = raw.strip()
        if not value or value in seen:
            continue
        if len(value) > max_length:
            raise CaptureIngressError(f"{field} entries must be at most {max_length} characters")
        normalized.append(value)
        seen.add(value)
    return normalized


def _find_capture_by_external_key(threads_dir: Path, source: str, external_id: str) -> Note | None:
    """Find an active or archived capture matching a stable producer key."""
    if not threads_dir.exists():
        return None
    for path in sorted(threads_dir.rglob("*.md")):
        try:
            note = parse_note(path)
        except (OSError, yaml.YAMLError, ValidationError, ValueError):
            continue
        if (
            note.type == "capture"
            and note.source == source
            and str(note.extra.get("external_id") or "") == external_id
        ):
            return note
    return None


def _capture_path(
    captures_dir: Path,
    *,
    title: str,
    capture_id: str,
    filename_stem: str | None,
    filename_prefix: str | None,
) -> Path:
    """Choose a sanitized, non-clobbering filename inside ``captures/``."""
    if filename_stem:
        stem = to_kebab(filename_stem)
    elif filename_prefix:
        prefix = to_kebab(filename_prefix) or "capture"
        stem = f"{prefix}-{capture_id}"
    else:
        stem = to_kebab(title) or capture_id
    if not stem:
        stem = capture_id

    candidate = captures_dir / f"{stem}.md"
    counter = 1
    while candidate.exists():
        suffix = capture_id if counter == 1 else f"{capture_id}-{counter}"
        candidate = captures_dir / f"{stem}-{suffix}.md"
        counter += 1
    return candidate


async def _ensure_worker(vault_root: Path, policy: CaptureProcessingConfig) -> None:
    """Best-effort worker self-heal after a successful ingress transaction."""
    service = get_capture_job_service()
    if not service.enabled:
        return
    try:
        await service.ensure_active(vault_root, policy)
    except CaptureJobsBusyError:
        logger.debug("Capture worker self-heal deferred during vault handoff")
    except Exception:
        logger.warning("Could not activate capture worker", exc_info=True)


async def ingest_capture(
    vault_root: Path,
    *,
    title: str,
    body: str = "",
    source: str = "manual",
    tags: list[str] | tuple[str, ...] = (),
    external_id: str | None = None,
    provenance: dict[str, Any] | None = None,
    author: str = "user",
    links: list[str] | tuple[str, ...] = (),
    history_reason: str | None = None,
    filename_stem: str | None = None,
    filename_prefix: str | None = None,
    policy: CaptureProcessingConfig | None = None,
    index: NoteIndex | None = None,
) -> CaptureIngressResult:
    """Create one durable Inbox capture and its immediately eligible job.

    ``source`` plus ``external_id`` is the idempotency key. Archived captures
    count as existing so a producer retry cannot recreate work that Loom has
    already filed. ``filename_stem``/``filename_prefix`` preserve established
    producer filenames but are always slugified before use.
    """
    from agents.file_locks import path_lock

    root = vault_root.resolve()
    threads_dir = root / "threads"
    captures_dir = threads_dir / "captures"
    normalized_title = _required_text(title, "title", max_length=300)
    normalized_source = _source(source)
    normalized_author = _required_text(author, "author", max_length=200)
    normalized_external_id = _optional_external_id(external_id)
    normalized_tags = _string_list(tags, "tags")
    normalized_links = _string_list(links, "links", max_items=500, max_length=500)
    if not isinstance(body, str):
        raise CaptureIngressError("body must be text")
    if provenance is not None and not isinstance(provenance, dict):
        raise CaptureIngressError("provenance must be an object")

    selected_policy = policy or capture_processing_policy_for_vault(root)
    selected_index = index or get_note_index()
    service = get_capture_job_service()
    created_note: Note
    capture_path: Path
    job: CaptureJob | None = None
    job_changed = False

    async with service.operation_guard(root):
        captures_dir.mkdir(parents=True, exist_ok=True)
        # Serialize the dedupe scan and write so concurrent producer retries
        # cannot both observe a missing external key.
        async with path_lock(captures_dir / ".capture-ingest"):
            if normalized_external_id is not None:
                existing = await asyncio.to_thread(
                    _find_capture_by_external_key,
                    threads_dir,
                    normalized_source,
                    normalized_external_id,
                )
                if existing is not None:
                    return CaptureIngressResult(
                        capture=existing,
                        capture_path=Path(existing.file_path),
                        created=False,
                        deduplicated=True,
                    )

            capture_id = generate_id()
            timestamp = now_iso()
            meta: dict[str, Any] = {
                "id": capture_id,
                "title": normalized_title,
                "type": "capture",
                "tags": normalized_tags,
                "created": timestamp,
                "modified": timestamp,
                "author": normalized_author,
                "source": normalized_source,
                "links": normalized_links,
                "status": "active",
                "history": [
                    {
                        "action": "created",
                        "by": normalized_author,
                        "at": timestamp,
                        "reason": history_reason or f"Captured via {normalized_source}",
                    }
                ],
            }
            if normalized_external_id is not None:
                meta["external_id"] = normalized_external_id
            if provenance:
                meta["provenance"] = dict(provenance)

            capture_path = _capture_path(
                captures_dir,
                title=normalized_title,
                capture_id=capture_id,
                filename_stem=filename_stem,
                filename_prefix=filename_prefix,
            )
            write_note(root, capture_path, meta, body)
            selected_index.refresh_file(capture_path)
            # Parse before notifying a worker that may immediately claim it.
            created_note = parse_note(capture_path)

            if selected_policy.permits(normalized_source):
                enqueue_result = await asyncio.to_thread(
                    capture_job_store(root).enqueue,
                    capture_path,
                    created_note.id,
                    created_note.source,
                    selected_policy,
                )
                job = enqueue_result.job
                job_changed = enqueue_result.created

    # Capture and job consumers refresh independently. Manual policy has no job
    # row, while automatic policy creates both domains in this transaction.
    publish_capture_change()
    if job_changed:
        publish_job_change()
        service.notify(root)
    await _ensure_worker(root, selected_policy)
    return CaptureIngressResult(
        capture=created_note,
        capture_path=capture_path,
        created=True,
        deduplicated=False,
        job=job,
    )
