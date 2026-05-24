"""Integration tests for vault API endpoints."""

import io
import tarfile
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


class TestCreateVault:
    """POST /api/vaults"""

    def test_create_201(self, client: TestClient) -> None:
        resp = client.post("/api/vaults", json={"name": "test"})
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "test"
        assert data["is_active"] is True

    def test_duplicate_409(self, client: TestClient) -> None:
        client.post("/api/vaults", json={"name": "test"})
        resp = client.post("/api/vaults", json={"name": "test"})
        assert resp.status_code == 409

    def test_invalid_name_422(self, client: TestClient) -> None:
        resp = client.post("/api/vaults", json={"name": "bad name!"})
        assert resp.status_code == 422


class TestListVaults:
    """GET /api/vaults"""

    def test_empty(self, client: TestClient) -> None:
        resp = client.get("/api/vaults")
        assert resp.status_code == 200
        assert resp.json()["vaults"] == []

    def test_with_vaults(self, client: TestClient) -> None:
        client.post("/api/vaults", json={"name": "alpha"})
        client.post("/api/vaults", json={"name": "beta"})
        resp = client.get("/api/vaults")
        names = [v["name"] for v in resp.json()["vaults"]]
        assert "alpha" in names
        assert "beta" in names


class TestActiveVault:
    """GET/PUT /api/vaults/active"""

    def test_get_active(self, client: TestClient) -> None:
        client.post("/api/vaults", json={"name": "test"})
        resp = client.get("/api/vaults/active")
        assert resp.status_code == 200
        assert resp.json()["name"] == "test"

    def test_set_active(self, client: TestClient) -> None:
        client.post("/api/vaults", json={"name": "first"})
        client.post("/api/vaults", json={"name": "second"})
        resp = client.put("/api/vaults/active", json={"name": "second"})
        assert resp.status_code == 200
        assert client.get("/api/vaults/active").json()["name"] == "second"

    def test_set_active_rebuilds_note_index(
        self, client: TestClient, vault_manager, note_index
    ) -> None:
        client.post("/api/vaults", json={"name": "first"})
        client.post("/api/vaults", json={"name": "second"})
        _write_note(vault_manager.vault_path("first"), "thr_first", "First Note")
        _write_note(vault_manager.vault_path("second"), "thr_second", "Second Note")
        note_index.build(vault_manager.vault_path("first") / "threads")

        resp = client.put("/api/vaults/active", json={"name": "second"})

        assert resp.status_code == 200
        notes = client.get("/api/notes").json()["notes"]
        assert [n["title"] for n in notes] == ["Second Note"]

    def test_set_nonexistent_404(self, client: TestClient) -> None:
        resp = client.put("/api/vaults/active", json={"name": "nope"})
        assert resp.status_code == 404


class TestExportVault:
    """GET /api/vaults/{name}/export"""

    def test_export_contains_restorable_vault_parts(
        self, client: TestClient, vault_manager
    ) -> None:
        client.post("/api/vaults", json={"name": "test"})
        _write_note(vault_manager.vault_path("test"), "thr_export", "Exported")

        resp = client.get("/api/vaults/test/export")

        assert resp.status_code == 200
        with tarfile.open(fileobj=io.BytesIO(resp.content), mode="r:gz") as tar:
            names = set(tar.getnames())
        assert "test/vault.yaml" in names
        assert "test/threads/topics/thr_export.md" in names
        assert "test/agents/weaver/config.yaml" in names
        assert "test/rules/prime.md" in names
        assert "test/prompts/shared/system-preamble.md" in names


class TestRenameVault:
    """PATCH /api/vaults/{name}"""

    def test_rename_inactive(self, client: TestClient) -> None:
        client.post("/api/vaults", json={"name": "first"})
        client.post("/api/vaults", json={"name": "second"})
        # 'first' is active (init_vault sets first as active). Rename inactive.
        resp = client.patch("/api/vaults/second", json={"new_name": "beta"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "beta"
        assert data["is_active"] is False

    def test_rename_active_updates_config(self, client: TestClient) -> None:
        client.post("/api/vaults", json={"name": "only"})
        resp = client.patch("/api/vaults/only", json={"new_name": "renamed"})
        assert resp.status_code == 200
        assert resp.json()["is_active"] is True
        assert client.get("/api/vaults/active").json()["name"] == "renamed"

    def test_rename_conflict(self, client: TestClient) -> None:
        client.post("/api/vaults", json={"name": "first"})
        client.post("/api/vaults", json={"name": "second"})
        resp = client.patch("/api/vaults/first", json={"new_name": "second"})
        assert resp.status_code == 409

    def test_rename_missing_404(self, client: TestClient) -> None:
        resp = client.patch("/api/vaults/ghost", json={"new_name": "real"})
        assert resp.status_code == 404

    def test_rename_invalid_name_422(self, client: TestClient) -> None:
        client.post("/api/vaults", json={"name": "test"})
        resp = client.patch("/api/vaults/test", json={"new_name": "bad name!"})
        assert resp.status_code == 422
