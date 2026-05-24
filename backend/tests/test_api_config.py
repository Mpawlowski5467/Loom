"""Integration tests for /api/config."""

from pathlib import Path

from starlette.testclient import TestClient

from core.notes import note_to_file_content


def _write_note(vault_root: Path, note_id: str, title: str) -> None:
    path = vault_root / "threads" / "topics" / f"{note_id}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        note_to_file_content(
            {
                "id": note_id,
                "title": title,
                "type": "topic",
                "tags": [],
                "history": [],
            },
            "Body",
        )
    )


def test_patch_active_vault_validates_name(client: TestClient) -> None:
    resp = client.patch("/api/config", json={"active_vault": "../outside"})

    assert resp.status_code == 422


def test_patch_active_vault_requires_existing_vault(client: TestClient) -> None:
    resp = client.patch("/api/config", json={"active_vault": "missing"})

    assert resp.status_code == 404


def test_patch_active_vault_rebuilds_runtime_index(
    client: TestClient,
    vault_manager,
    note_index,
) -> None:
    client.post("/api/vaults", json={"name": "first"})
    client.post("/api/vaults", json={"name": "second"})
    _write_note(vault_manager.vault_path("first"), "thr_first", "First Note")
    _write_note(vault_manager.vault_path("second"), "thr_second", "Second Note")
    note_index.build(vault_manager.vault_path("first") / "threads")

    resp = client.patch("/api/config", json={"active_vault": "second"})

    assert resp.status_code == 200
    assert resp.json()["active_vault"] == "second"
    notes = client.get("/api/notes").json()["notes"]
    assert [n["title"] for n in notes] == ["Second Note"]
