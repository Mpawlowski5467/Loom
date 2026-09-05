"""Read-only connection evidence for note relationships."""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from agents.file_locks import path_lock
from core.events import publish_note_change
from core.note_index import NoteIndex, get_note_index
from core.notes import is_published, matches_version, now_iso, parse_note
from core.rate_limit import WRITE_LIMIT, limiter
from core.vault import VaultManager, get_vault_manager
from core.vault_io import write_note

router = APIRouter(prefix="/api/connections", tags=["connections"])


class ConnectionEvidence(BaseModel):
    direction: str
    source_id: str
    target_id: str
    state: str
    method: str
    rationale: str
    source_excerpt: str = ""
    target_excerpt: str = ""
    score: float | None = None
    created: str = ""
    agent: str = ""
    run_id: str = ""
    source_modified: str = ""
    target_modified: str = ""
    source_title: str = ""
    target_title: str = ""


class ConnectionsResponse(BaseModel):
    note_id: str
    connections: list[ConnectionEvidence] = Field(default_factory=list)


class AcceptConnectionRequest(BaseModel):
    source_id: str
    target_id: str
    source_modified: str
    target_modified: str


@router.get("/{note_id}", response_model=ConnectionsResponse)
async def note_connections(
    note_id: str,
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> ConnectionsResponse:
    """List incoming and outgoing relationship evidence for one note."""
    entries = {entry.id: entry for entry in index.all_entries()}
    if note_id not in entries:
        raise HTTPException(status_code=404, detail="Note not found")
    results: list[ConnectionEvidence] = []
    for source in entries.values():
        if source.meta.status != "active":
            continue
        resolved = [
            index.resolve_wikilink(raw)
            for raw in [*source.meta.links, *re.findall(r"\[\[([^\]]+)\]\]", source.body)]
        ]
        linked_ids = {entry.id for entry in resolved if entry is not None}
        evidence = source.meta.extra.get("link_evidence", [])
        recorded_targets: set[str] = set()
        if isinstance(evidence, list):
            for raw in evidence:
                if not isinstance(raw, dict) or raw.get("source_id") != source.id:
                    continue
                target_id = str(raw.get("target_id", ""))
                target = entries.get(target_id)
                if target is None or target.meta.status != "active":
                    continue
                recorded_targets.add(target_id)
                if source.id != note_id and target_id != note_id:
                    continue
                state = str(raw.get("state", "applied"))
                if state in {"applied", "user_accepted"} and target_id not in linked_ids:
                    state = "historical"
                results.append(
                    ConnectionEvidence(
                        direction="outgoing" if source.id == note_id else "incoming",
                        source_id=source.id,
                        target_id=target_id,
                        state=state,
                        method=str(raw.get("method", "recorded")),
                        rationale=str(raw.get("reason", "Recorded connection.")),
                        source_excerpt=str(raw.get("source_excerpt", "")),
                        target_excerpt=str(raw.get("target_excerpt", "")),
                        score=float(raw["score"])
                        if isinstance(raw.get("score"), (int, float))
                        else None,
                        created=str(raw.get("created", "")),
                        agent=str(raw.get("agent", "")),
                        run_id=str(raw.get("run_id", "")),
                        source_modified=source.meta.content_version or source.meta.modified,
                        target_modified=target.meta.content_version or target.meta.modified,
                        source_title=source.title,
                        target_title=target.title,
                    )
                )
        for target_id in linked_ids - recorded_targets:
            target = entries.get(target_id)
            if target is None or (source.id != note_id and target_id != note_id):
                continue
            results.append(
                ConnectionEvidence(
                    direction="outgoing" if source.id == note_id else "incoming",
                    source_id=source.id,
                    target_id=target_id,
                    state="applied",
                    method="manual/legacy",
                    rationale="manual/legacy; no recorded rationale",
                    source_modified=source.meta.content_version or source.meta.modified,
                    target_modified=target.meta.content_version or target.meta.modified,
                    source_title=source.title,
                    target_title=target.title,
                )
            )
    return ConnectionsResponse(note_id=note_id, connections=results)


@router.post("/accept")
@limiter.limit(WRITE_LIMIT)
async def accept_connection(
    request: Request,  # noqa: ARG001
    body: AcceptConnectionRequest,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
    index: NoteIndex = Depends(get_note_index),  # noqa: B008
) -> dict[str, str]:
    """Turn one reviewed suggestion into a user-audited wikilink."""
    root = vm.active_vault_dir()
    source_path, target_path = (
        index.get_path_by_id(body.source_id),
        index.get_path_by_id(body.target_id),
    )
    if source_path is None or target_path is None or source_path == target_path:
        raise HTTPException(status_code=400, detail="Invalid connection identities")
    first, second = sorted((source_path, target_path), key=str)
    async with path_lock(first), path_lock(second):
        source, target = parse_note(source_path), parse_note(target_path)
        if (
            source.id != body.source_id
            or target.id != body.target_id
            or source.status != "active"
            or target.status != "active"
            or not is_published(source)
            or not is_published(target)
            or not source_path.resolve().is_relative_to((root / "threads").resolve())
            or not target_path.resolve().is_relative_to((root / "threads").resolve())
        ):
            raise HTTPException(status_code=409, detail="Connection changed; reload and retry.")
        if not matches_version(source, body.source_modified) or not matches_version(
            target, body.target_modified
        ):
            raise HTTPException(status_code=409, detail="Connection changed; reload and retry.")
        ts = now_iso()
        meta = source.model_dump(exclude={"body", "wikilinks", "file_path"})
        meta["modified"] = ts
        meta["history"].append(
            {
                "action": "linked",
                "by": "user",
                "at": ts,
                "reason": f"Accepted suggested link to [[{target.title}]]",
            }
        )
        meta.update(source.extra)
        evidence = meta.get("link_evidence", [])
        if not isinstance(evidence, list):
            evidence = []
        matched = False
        updated: list[object] = []
        for item in evidence:
            if (
                isinstance(item, dict)
                and item.get("source_id") == source.id
                and item.get("target_id") == target.id
                and item.get("state") == "suggested"
            ):
                updated.append(
                    {
                        **item,
                        "state": "user_accepted",
                        "created": ts,
                        "agent": "user",
                        "reason": "User accepted the suggested relation.",
                    }
                )
                matched = True
            else:
                updated.append(item)
        if not matched:
            raise HTTPException(
                status_code=409, detail="Suggested connection is no longer available; reload."
            )
        meta["link_evidence"] = updated[-100:]
        already_linked = any(
            (entry := index.resolve_wikilink(raw)) is not None and entry.id == target.id
            for raw in [*source.links, *source.wikilinks]
        )
        target_link = target_path.relative_to(root / "threads").with_suffix("").as_posix()
        next_body = (
            source.body
            if already_linked
            else source.body.rstrip() + f"\n\n[[{target_link}|{target.title}]]\n"
        )
        write_note(root, source_path, meta, next_body)
        index.refresh_file(source_path)
    publish_note_change()
    return {"status": "accepted", "source_id": body.source_id, "target_id": body.target_id}
