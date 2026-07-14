"""Integration tests for vault API endpoints."""

import asyncio
import io
import tarfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from starlette.testclient import TestClient

import api.routers.vaults as vault_routes
import core.vault_handoff as handoff_mod
from core.notes import note_to_file_content
from core.standup_scheduler import StandupSchedulerService


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

    @pytest.mark.parametrize(
        "operation",
        ["switch", "archive", "delete", "rename", "import"],
    )
    def test_active_handoff_refuses_a_running_scheduled_standup(
        self,
        operation: str,
        client: TestClient,
        vault_manager,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        client.post("/api/vaults", json={"name": "first"})
        client.post("/api/vaults", json={"name": "second"})
        root = vault_manager.vault_path("first")
        marker = root / "threads" / "handoff-marker.md"
        marker.write_text("unchanged", encoding="utf-8")
        scheduler = StandupSchedulerService()
        asyncio.run(scheduler._run_lock.acquire())
        monkeypatch.setattr(handoff_mod, "get_standup_scheduler", lambda: scheduler)
        try:
            if operation == "switch":
                resp = client.put("/api/vaults/active", json={"name": "second"})
            elif operation == "archive":
                resp = client.post("/api/vaults/first/archive")
            elif operation == "delete":
                resp = client.delete("/api/vaults/first", params={"hard": "true"})
            elif operation == "rename":
                resp = client.patch("/api/vaults/first", json={"new_name": "renamed"})
            else:
                resp = client.post(
                    "/api/vaults/first/import",
                    params={"overwrite": "true"},
                    content=_make_export_tarball("first"),
                )
        finally:
            scheduler._run_lock.release()

        assert resp.status_code == 409
        assert client.get("/api/vaults/active").json()["name"] == "first"
        assert marker.read_text(encoding="utf-8") == "unchanged"
        assert not vault_manager.vault_path("renamed").exists()
        assert not list(vault_manager._settings.vaults_dir.glob("first.archived-*"))
        assert not (root / "threads" / "topics" / "thr_imp.md").exists()
        assert scheduler.paused is False

    def test_set_active_resumes_scheduler_after_reload_failure(
        self,
        client: TestClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        client.post("/api/vaults", json={"name": "first"})
        client.post("/api/vaults", json={"name": "second"})
        scheduler = StandupSchedulerService()
        monkeypatch.setattr(handoff_mod, "get_standup_scheduler", lambda: scheduler)
        monkeypatch.setattr(
            vault_routes,
            "reload_active_vault_runtime",
            lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("reload failed")),
        )

        resp = client.put("/api/vaults/active", json={"name": "second"})

        assert resp.status_code == 409
        assert client.get("/api/vaults/active").json()["name"] == "first"
        assert scheduler.paused is False


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
        # FileResponse removes its on-disk spool only after the response body
        # has finished streaming.
        assert not list(vault_manager._settings.loom_home.glob(".loom-export-*"))


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

    def test_import_rejects_compressed_size_over_limit(
        self,
        client: TestClient,
        vault_manager,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        payload = _make_export_tarball("large")
        monkeypatch.setattr(vault_routes, "_MAX_IMPORT_ARCHIVE_BYTES", len(payload) - 1)

        resp = client.post("/api/vaults/large/import", content=payload)

        assert resp.status_code == 413
        assert not vault_manager.vault_path("large").exists()
        assert not list(vault_manager._settings.loom_home.glob(".loom-import-upload-*"))

    def test_import_rejects_expanded_size_over_limit(
        self,
        client: TestClient,
        vault_manager,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(vault_routes, "_MAX_IMPORT_EXPANDED_BYTES", 1)

        resp = client.post(
            "/api/vaults/expanded/import",
            content=_make_export_tarball("expanded"),
        )

        assert resp.status_code == 413
        assert not vault_manager.vault_path("expanded").exists()
        assert not list(vault_manager._settings.loom_home.glob(".loom-import-upload-*"))

    def test_failed_promotion_restores_previous_vault(
        self,
        client: TestClient,
        vault_manager,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        client.post("/api/vaults", json={"name": "occupied"})
        root = vault_manager.vault_path("occupied")
        marker = root / "threads" / "old-state.md"
        marker.write_text("original vault", encoding="utf-8")
        real_rename = vault_routes._atomic_rename

        def fail_ready_promotion(source: Path, destination: Path) -> None:
            if source.name == ".occupied.import-ready" and destination.name == "occupied":
                raise OSError("injected promotion failure")
            real_rename(source, destination)

        monkeypatch.setattr(vault_routes, "_atomic_rename", fail_ready_promotion)

        resp = client.post(
            "/api/vaults/occupied/import",
            params={"overwrite": "true"},
            content=_make_export_tarball("occupied"),
        )

        assert resp.status_code == 500
        assert marker.read_text(encoding="utf-8") == "original vault"
        assert not (root / "threads" / "topics" / "thr_imp.md").exists()
        assert not vault_routes._import_ready_path(root).exists()
        assert not vault_routes._import_backup_path(root).exists()

    def test_non_vault_directory_requires_explicit_overwrite(
        self,
        client: TestClient,
        vault_manager,
    ) -> None:
        root = vault_manager.vault_path("unmanaged")
        root.mkdir(parents=True)
        marker = root / "keep.txt"
        marker.write_text("do not clobber", encoding="utf-8")

        resp = client.post(
            "/api/vaults/unmanaged/import",
            content=_make_export_tarball("unmanaged"),
        )

        assert resp.status_code == 409
        assert marker.read_text(encoding="utf-8") == "do not clobber"


def test_recover_interrupted_import_restores_backup_and_discards_ready(
    vault_manager,
) -> None:
    vaults_dir = vault_manager._settings.vaults_dir
    vaults_dir.mkdir(parents=True, exist_ok=True)
    dest = vaults_dir / "recovering"
    dest.mkdir()
    (dest / "old.txt").write_text("old", encoding="utf-8")
    backup = vault_routes._import_backup_path(dest)
    ready = vault_routes._import_ready_path(dest)
    dest.replace(backup)
    ready.mkdir()
    (ready / "new.txt").write_text("new", encoding="utf-8")

    vault_routes.recover_interrupted_vault_imports(vaults_dir)

    assert (dest / "old.txt").read_text(encoding="utf-8") == "old"
    assert not (dest / "new.txt").exists()
    assert not backup.exists()
    assert not ready.exists()


def test_concurrent_create_only_imports_do_not_overwrite_each_other(
    tmp_path: Path,
) -> None:
    vaults_dir = tmp_path / "vaults"
    vaults_dir.mkdir()
    first_archive = tmp_path / "first.tar.gz"
    second_archive = tmp_path / "second.tar.gz"
    first_archive.write_bytes(_make_export_tarball("first"))
    second_archive.write_bytes(_make_export_tarball("second"))
    dest = vaults_dir / "shared"

    def restore(archive: Path) -> str:
        try:
            vault_routes._restore_tarball(
                archive,
                dest,
                vaults_dir,
                overwrite=False,
            )
        except vault_routes.VaultImportConflictError:
            return "conflict"
        return "restored"

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(restore, (first_archive, second_archive)))

    assert sorted(outcomes) == ["conflict", "restored"]
    assert (dest / "threads" / "topics" / "thr_imp.md").exists()


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
