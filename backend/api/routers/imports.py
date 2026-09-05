"""Small, bounded attachment pilot: public URL clips and PDF text extraction."""

import asyncio
import hashlib
import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from api.routers.captures import _capture_item
from core.capture_ingress import CaptureIngressError, ingest_capture
from core.clipper import MAX_BYTES, ClipError, extract, fetch_url, preserve_original
from core.note_index import NoteIndex, get_note_index
from core.notes import now_iso
from core.rate_limit import READ_LIMIT, WRITE_LIMIT, limiter
from core.vault import VaultManager, get_vault_manager

router = APIRouter(prefix="/api/imports", tags=["imports"])
_SLOTS = asyncio.Semaphore(2)


class ClipRequest(BaseModel):
    url: str = Field(min_length=1, max_length=4000)
    title: str = Field(default="", max_length=200)


async def _ingest(
    vm: VaultManager,
    root: Path,
    index: NoteIndex,
    raw: bytes,
    content_type: str,
    source_url: str = "",
    title: str = "",
) -> dict[str, Any]:
    text, extracted_title, extension = await asyncio.to_thread(extract, raw, content_type)
    digest, filename = await asyncio.to_thread(preserve_original, root, raw, extension)
    if vm.active_vault_dir() != root:
        raise HTTPException(
            409, "The active vault changed during import; retry in the intended vault"
        )
    source_line = f"Source: {source_url}\n\n" if source_url else ""
    original = f"[Download original](/api/imports/files/{filename})"
    result = await ingest_capture(
        root,
        title=" ".join((title.strip() or extracted_title or "Imported document").split()),
        body=f"{source_line}{original}\n\n{text}",
        source="manual:clipper" if source_url else "manual:pdf",
        external_id=hashlib.sha256(f"{source_url}:{digest}".encode()).hexdigest(),
        provenance={
            "source_url": source_url,
            "original_file": f"attachments/{filename}",
            "sha256": digest,
            "extraction": "pypdf text"
            if extension == "pdf"
            else "HTML text"
            if extension == "html"
            else "plain text",
            "extracted_at": now_iso(),
            "source_bytes": len(raw),
            "extracted_characters": len(text),
        },
        automated=False,
        index=index,
    )
    return {
        "capture": _capture_item(result.capture).model_dump(),
        "created": result.created,
        "deduplicated": result.deduplicated,
        "job": result.job.model_dump() if result.job else None,
    }


@router.post("/url", status_code=201)
@limiter.limit(WRITE_LIMIT)
async def clip(
    request: Request,
    body: ClipRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> dict[str, Any]:  # noqa: ARG001
    root = vm.active_vault_dir()
    try:
        async with _SLOTS:
            raw, content_type, final_url = await asyncio.to_thread(fetch_url, body.url)
            return await _ingest(vm, root, index, raw, content_type, final_url, body.title)
    except (ClipError, CaptureIngressError, OSError) as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/pdf", status_code=201)
@limiter.limit(WRITE_LIMIT)
async def pdf(
    request: Request,
    title: str = Query("", max_length=200),
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> dict[str, Any]:
    root = vm.active_vault_dir()
    data = bytearray()
    try:
        async with asyncio.timeout(30):
            async for chunk in request.stream():
                if len(data) + len(chunk) > MAX_BYTES:
                    raise HTTPException(413, "PDF exceeds the 8 MiB import limit")
                data.extend(chunk)
        if not data.startswith(b"%PDF-"):
            raise HTTPException(400, "Upload a PDF file")
        async with _SLOTS:
            return await _ingest(vm, root, index, bytes(data), "application/pdf", title=title)
    except TimeoutError as exc:
        raise HTTPException(408, "PDF upload exceeded the 30 second limit") from exc
    except (ClipError, CaptureIngressError, OSError) as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/files/{filename}")
@limiter.limit(READ_LIMIT)
def original(
    request: Request,
    filename: str,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> FileResponse:  # noqa: ARG001
    if not re.fullmatch(r"[a-f0-9]{64}\.(pdf|html|txt)", filename):
        raise HTTPException(404, "Original not found")
    directory = vm.active_vault_dir() / "attachments"
    path = directory / filename
    if directory.is_symlink() or path.is_symlink() or not path.is_file():
        raise HTTPException(404, "Original not found")
    return FileResponse(
        path,
        filename=filename,
        media_type="application/octet-stream",
        headers={
            "Content-Security-Policy": "sandbox; default-src 'none'",
            "X-Content-Type-Options": "nosniff",
        },
    )
