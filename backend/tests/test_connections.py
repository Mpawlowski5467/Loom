from pathlib import Path

import pytest
from starlette.testclient import TestClient

from core.notes import parse_note
from tests.conftest import _seed_notes

SOURCE = (
    "topics",
    "source.md",
    {
        "id": "source",
        "title": "Source",
        "type": "topic",
        "tags": [],
        "created": "2026-01-01T00:00:00Z",
        "modified": "2026-01-01T00:00:00Z",
        "author": "you",
        "source": "manual",
        "status": "active",
        "history": [],
        "link_evidence": [
            {
                "source_id": "source",
                "target_id": "target",
                "state": "suggested",
                "method": "spider-candidate",
                "reason": "Shared terms: cache.",
                "source_excerpt": "source excerpt",
                "target_excerpt": "target excerpt",
            },
            {
                "source_id": "source",
                "target_id": "other",
                "state": "suggested",
                "method": "spider-candidate",
                "reason": "keep",
                "source_excerpt": "",
                "target_excerpt": "",
            },
        ],
    },
    "Body",
)
TARGET = (
    "topics",
    "target.md",
    {
        "id": "target",
        "title": "Target",
        "type": "topic",
        "tags": [],
        "created": "2026-01-01T00:00:00Z",
        "modified": "2026-01-02T00:00:00Z",
        "author": "you",
        "source": "manual",
        "status": "active",
        "history": [],
    },
    "Target body",
)


@pytest.fixture()
def connection_vault(vault_manager, note_index) -> Path:
    return _seed_notes(vault_manager, note_index, [SOURCE, TARGET])


def test_accept_suggestion_preserves_other_evidence(
    client: TestClient, connection_vault: Path
) -> None:
    response = client.post(
        "/api/connections/accept",
        json={
            "source_id": "source",
            "target_id": "target",
            "source_modified": "2026-01-01T00:00:00Z",
            "target_modified": "2026-01-02T00:00:00Z",
        },
    )
    assert response.status_code == 200
    source = parse_note(connection_vault / "threads/topics/source.md")
    assert "topics/target|Target" in source.wikilinks
    evidence = source.extra["link_evidence"]
    assert evidence[0]["state"] == "user_accepted" and evidence[1]["state"] == "suggested"


def test_stale_target_does_not_write_source(client: TestClient, connection_vault: Path) -> None:
    source_path = connection_vault / "threads/topics/source.md"
    before = source_path.read_text()
    response = client.post(
        "/api/connections/accept",
        json={
            "source_id": "source",
            "target_id": "target",
            "source_modified": "2026-01-01T00:00:00Z",
            "target_modified": "stale",
        },
    )
    assert response.status_code == 409 and source_path.read_text() == before


def test_outgoing_evidence_uses_endpoint_versions(
    client: TestClient, connection_vault: Path
) -> None:
    response = client.get("/api/connections/source")
    assert response.status_code == 200
    edge = response.json()["connections"][0]
    assert (
        edge["source_modified"]
        == parse_note(connection_vault / "threads/topics/source.md").content_version
    )
    assert (
        edge["target_modified"]
        == parse_note(connection_vault / "threads/topics/target.md").content_version
    )


def test_legacy_slug_link_visible_in_both_directions(
    client: TestClient, connection_vault: Path, note_index
) -> None:
    from core.vault_io import write_note

    path = connection_vault / "threads/topics/source.md"
    note = parse_note(path)
    meta = note.model_dump(exclude={"body", "wikilinks", "file_path"})
    meta["extra"].pop("link_evidence", None)
    write_note(connection_vault, path, meta, "See [[topics/target#Heading]].")
    note_index.refresh_file(path)
    outgoing = client.get("/api/connections/source").json()["connections"]
    incoming = client.get("/api/connections/target").json()["connections"]
    assert outgoing[0]["method"] == incoming[0]["method"] == "manual/legacy"
    assert outgoing[0]["direction"] == "outgoing"
    assert incoming[0]["direction"] == "incoming"
