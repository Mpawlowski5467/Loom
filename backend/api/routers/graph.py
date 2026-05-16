"""Graph API route."""

import hashlib
from datetime import datetime
from email.utils import format_datetime, parsedate_to_datetime

from fastapi import APIRouter, Depends, Header, Query, Response

from core.graph import VaultGraph, build_graph, load_graph, save_graph
from core.vault import VaultManager, get_vault_manager

router = APIRouter(prefix="/api/graph", tags=["graph"])


def _compute_etag(updated_at: str, note_type: str | None, tag: str | None) -> str:
    """ETag combining updated_at with filter params so different filters differ."""
    raw = f"{updated_at}|{note_type or ''}|{tag or ''}"
    return '"' + hashlib.sha1(raw.encode("utf-8")).hexdigest() + '"'


def _http_date(updated_at: str) -> str | None:
    """Convert ISO timestamp to RFC 7231 HTTP-date for Last-Modified."""
    if not updated_at:
        return None
    try:
        dt = datetime.fromisoformat(updated_at)
    except ValueError:
        return None
    return format_datetime(dt, usegmt=True)


def _not_modified(if_modified_since: str | None, updated_at: str) -> bool:
    """Return True if the client's If-Modified-Since covers our updated_at."""
    if not if_modified_since or not updated_at:
        return False
    try:
        client_dt = parsedate_to_datetime(if_modified_since)
        server_dt = datetime.fromisoformat(updated_at)
    except (TypeError, ValueError):
        return False
    if client_dt is None or client_dt.tzinfo is None or server_dt.tzinfo is None:
        return False
    # HTTP-date has 1-second resolution; compare at second granularity.
    return server_dt.replace(microsecond=0) <= client_dt.replace(microsecond=0)


@router.get("", response_model=VaultGraph)
def get_graph(
    response: Response,
    note_type: str | None = Query(None, alias="type", description="Filter by note type"),
    tag: str | None = Query(None, description="Filter by tag"),
    if_none_match: str | None = Header(None, alias="If-None-Match"),
    if_modified_since: str | None = Header(None, alias="If-Modified-Since"),
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> VaultGraph | Response:
    """Return the vault knowledge graph, optionally filtered.

    Honors If-None-Match / If-Modified-Since with a 304 response when the
    client's cached graph is still fresh, so idle vaults cost ~1 byte.
    """
    tdir = vm.active_threads_dir()
    loom_dir = vm.active_loom_dir()

    # Try cached graph first; rebuild if missing
    graph = load_graph(loom_dir)
    if graph is None:
        graph = build_graph(tdir)
        if tdir.exists():
            save_graph(graph, loom_dir)

    etag = _compute_etag(graph.updated_at, note_type, tag)
    last_modified = _http_date(graph.updated_at)

    response.headers["ETag"] = etag
    if last_modified:
        response.headers["Last-Modified"] = last_modified
    response.headers["Cache-Control"] = "no-cache"

    if if_none_match and if_none_match == etag:
        not_modified = Response(status_code=304)
        not_modified.headers["ETag"] = etag
        if last_modified:
            not_modified.headers["Last-Modified"] = last_modified
        not_modified.headers["Cache-Control"] = "no-cache"
        return not_modified

    if _not_modified(if_modified_since, graph.updated_at):
        not_modified = Response(status_code=304)
        not_modified.headers["ETag"] = etag
        if last_modified:
            not_modified.headers["Last-Modified"] = last_modified
        not_modified.headers["Cache-Control"] = "no-cache"
        return not_modified

    if note_type is None and tag is None:
        return graph

    # Filter nodes
    filtered_ids: set[str] = set()
    filtered_nodes = []
    for node in graph.nodes:
        if note_type is not None and node.type != note_type:
            continue
        if tag is not None and tag not in node.tags:
            continue
        filtered_nodes.append(node)
        filtered_ids.add(node.id)

    # Keep only edges where both endpoints survive the filter
    filtered_edges = [
        e for e in graph.edges if e.source in filtered_ids and e.target in filtered_ids
    ]

    return VaultGraph(
        nodes=filtered_nodes,
        edges=filtered_edges,
        updated_at=graph.updated_at,
    )
