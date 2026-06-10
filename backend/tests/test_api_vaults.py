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


def _make_export_tarball(vault_name: str) -> bytes:
    """Build an export-style gzipped tarball for ``vault_name``.

    Mirrors :func:`export_vault`'s arcname layout: a single top-level
    ``<name>/`` directory containing ``vault.yaml`` and a note.
    """
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        yaml = f"name: {vault_name}\n".encode()
        info = tarfile.TarInfo(f"{vault_name}/vault.yaml")
        info.size = len(yaml)
        tar.addfile(info, io.BytesIO(yaml))

        note = b"# restored note\n"
        note_info = tarfile.TarInfo(f"{vault_name}/threads/topics/thr_imp.md")
        note_info.size = len(note)
        tar.addfile(note_info, io.BytesIO(note))
    return buffer.getvalue()


def _make_traversal_tarball() -> bytes:
    """Build a malicious tarball with a ``../`` path-traversal member."""
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        payload = b"pwned\n"
        info = tarfile.TarInfo("../../escape.txt")
        info.size = len(payload)
        tar.addfile(info, io.BytesIO(payload))
    return buffer.getvalue()


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


class TestVaultExists:
    """GET /api/vaults/exists"""

    def test_exists_true(self, client: TestClient) -> None:
        client.post("/api/vaults", json={"name": "real"})
        resp = client.get("/api/vaults/exists", params={"name": "real"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["exists"] is True
        assert body["scaffolded"] is True

    def test_missing_vault_returns_false(self, client: TestClient) -> None:
        resp = client.get("/api/vaults/exists", params={"name": "ghost"})
        assert resp.status_code == 200
        assert resp.json()["exists"] is False

    def test_invalid_name_rejected(self, client: TestClient) -> None:
        # Validated before any filesystem probe — no existence oracle for
        # arbitrary paths. Consistent with create/rename: 422.
        resp = client.get("/api/vaults/exists", params={"name": "../etc"})
        assert resp.status_code == 422

    def test_traversal_name_rejected(self, client: TestClient) -> None:
        resp = client.get("/api/vaults/exists", params={"name": "bad/name"})
        assert resp.status_code == 422


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


class TestImportVault:
    """POST /api/vaults/{name}/import"""

    def test_import_restores_vault(self, client: TestClient, vault_manager) -> None:
        resp = client.post(
            "/api/vaults/imported/import",
            content=_make_export_tarball("imported"),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "imported"

        root = vault_manager.vault_path("imported")
        assert (root / "vault.yaml").exists()
        assert (root / "threads" / "topics" / "thr_imp.md").exists()
        # Restored vault is now a real, listable vault.
        names = [v["name"] for v in client.get("/api/vaults").json()["vaults"]]
        assert "imported" in names

    def test_import_round_trips_an_export(self, client: TestClient, vault_manager) -> None:
        client.post("/api/vaults", json={"name": "source"})
        _write_note(vault_manager.vault_path("source"), "thr_rt", "RoundTrip")
        tarball = client.get("/api/vaults/source/export").content

        resp = client.post("/api/vaults/restored/import", content=tarball)

        assert resp.status_code == 201
        root = vault_manager.vault_path("restored")
        assert (root / "vault.yaml").exists()
        assert (root / "threads" / "topics" / "thr_rt.md").exists()

    def test_import_rejects_traversal_tarball(self, client: TestClient, vault_manager) -> None:
        resp = client.post(
            "/api/vaults/evil/import",
            content=_make_traversal_tarball(),
        )
        assert resp.status_code == 400
        # Nothing escaped the vaults directory.
        vaults_dir = vault_manager._settings.vaults_dir
        assert not (vaults_dir.parent / "escape.txt").exists()

    def test_import_refuses_overwrite_without_flag(self, client: TestClient) -> None:
        client.post("/api/vaults", json={"name": "occupied"})
        resp = client.post(
            "/api/vaults/occupied/import",
            content=_make_export_tarball("occupied"),
        )
        assert resp.status_code == 409

    def test_import_overwrite_with_flag(self, client: TestClient, vault_manager) -> None:
        client.post("/api/vaults", json={"name": "occupied"})
        resp = client.post(
            "/api/vaults/occupied/import",
            params={"overwrite": "true"},
            content=_make_export_tarball("occupied"),
        )
        assert resp.status_code == 201
        root = vault_manager.vault_path("occupied")
        assert (root / "threads" / "topics" / "thr_imp.md").exists()

    def test_import_invalid_name_rejected(self, client: TestClient) -> None:
        resp = client.post(
            "/api/vaults/bad%2Fname/import",
            content=_make_export_tarball("x"),
        )
        assert resp.status_code in (404, 422)

    def test_import_empty_body_rejected(self, client: TestClient) -> None:
        resp = client.post("/api/vaults/anything/import", content=b"")
        assert resp.status_code == 400


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
