"""Captures inbox API routes: listing and Weaver processing."""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core.note_index import NoteIndex, get_note_index
from core.notes import parse_note
from core.vault import VaultManager, get_vault_manager

router = APIRouter(prefix="/api/captures", tags=["captures"])


class CaptureItem(BaseModel):
    """A capture file with metadata and preview."""

    id: str = ""
    title: str = ""
    type: str = "capture"
    tags: list[str] = Field(default_factory=list)
    created: str = ""
    modified: str = ""
    author: str = ""
    source: str = ""
    status: str = "active"
    preview: str = ""
    file_path: str = ""


class ProcessCaptureRequest(BaseModel):
    """Request body for processing a single capture."""

    capture_path: str


class ProcessResult(BaseModel):
    """Result of processing a capture."""

    processed: bool
    note_id: str = ""
    note_title: str = ""
    note_type: str = ""
    target_path: str = ""
    error: str = ""


class ProcessAllResult(BaseModel):
    """Result of processing all pending captures."""

    total: int
    processed: int
    results: list[ProcessResult]


def _extract_preview(body: str, max_lines: int = 2) -> str:
    """Extract the first non-empty lines as a preview."""
    lines = [ln for ln in body.strip().splitlines() if ln.strip()]
    return "\n".join(lines[:max_lines])


def _list_captures(captures_dir: Path) -> list[CaptureItem]:
    """List all markdown files in captures/ with metadata and preview."""
    items: list[CaptureItem] = []
    if not captures_dir.exists():
        return items

    for md_file in sorted(captures_dir.glob("*.md"), reverse=True):
        try:
            note = parse_note(md_file)
            items.append(
                CaptureItem(
                    id=note.id,
                    title=note.title,
                    type=note.type,
                    tags=note.tags,
                    created=note.created,
                    modified=note.modified,
                    author=note.author,
                    source=note.source,
                    status=note.status,
                    preview=_extract_preview(note.body),
                    file_path=note.file_path,
                )
            )
        except Exception:  # noqa: BLE001
            continue

    return items


@router.get("")
def get_captures(
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> list[CaptureItem]:
    """Return all capture files with metadata and preview text."""
    captures_dir = vm.active_threads_dir() / "captures"
    return _list_captures(captures_dir)


@router.post("/process")
async def process_capture(
    body: ProcessCaptureRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> ProcessResult:
    """Process a single capture through Weaver.

    The capture_path should be relative to threads/ or an absolute path.
    """
    from agents.loom.weaver import get_weaver

    weaver = get_weaver()
    if weaver is None:
        raise HTTPException(
            status_code=503,
            detail="Weaver agent not initialized. Configure a chat provider.",
        )

    # Resolve the capture path
    capture_path = Path(body.capture_path)
    if not capture_path.is_absolute():
        capture_path = vm.active_threads_dir() / capture_path

    if not capture_path.exists():
        raise HTTPException(status_code=404, detail=f"Capture not found: {body.capture_path}")

    try:
        note = await weaver.process_capture(capture_path)
        if note is None:
            return ProcessResult(processed=False, error="Empty capture, skipped")
        index.refresh_file(Path(note.file_path))
        return ProcessResult(
            processed=True,
            note_id=note.id,
            note_title=note.title,
            note_type=note.type,
            target_path=note.file_path,
        )
    except Exception as exc:  # noqa: BLE001
        return ProcessResult(processed=False, error=str(exc))


@router.post("/process-all")
async def process_all_captures(
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> ProcessAllResult:
    """Process all pending captures in the inbox through Weaver."""
    from agents.loom.weaver import get_weaver

    weaver = get_weaver()
    if weaver is None:
        raise HTTPException(
            status_code=503,
            detail="Weaver agent not initialized. Configure a chat provider.",
        )

    captures_dir = vm.active_threads_dir() / "captures"
    if not captures_dir.exists():
        return ProcessAllResult(total=0, processed=0, results=[])

    md_files = sorted(captures_dir.glob("*.md"))
    results: list[ProcessResult] = []

    for capture_path in md_files:
        try:
            note = await weaver.process_capture(capture_path)
            if note is None:
                results.append(ProcessResult(processed=False, error="Empty capture"))
                continue
            index.refresh_file(Path(note.file_path))
            results.append(
                ProcessResult(
                    processed=True,
                    note_id=note.id,
                    note_title=note.title,
                    note_type=note.type,
                    target_path=note.file_path,
                )
            )
        except Exception as exc:  # noqa: BLE001
            results.append(ProcessResult(processed=False, error=str(exc)))

    processed_count = sum(1 for r in results if r.processed)
    return ProcessAllResult(
        total=len(md_files),
        processed=processed_count,
        results=results,
    )
