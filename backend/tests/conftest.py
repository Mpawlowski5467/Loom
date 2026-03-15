"""Shared test fixtures."""

from pathlib import Path

import pytest
from starlette.testclient import TestClient

from api.main import app
from core.config import LoomSettings
from core.note_index import NoteIndex, get_note_index
from core.notes import note_to_file_content
from core.vault import VaultManager, get_vault_manager


@pytest.fixture()
def tmp_loom_home(tmp_path: Path) -> LoomSettings:
    """Return LoomSettings rooted in a temp directory."""
    return LoomSettings(loom_home=tmp_path / ".loom")


@pytest.fixture()
def vault_manager(tmp_loom_home: LoomSettings) -> VaultManager:
    """Return a VaultManager backed by a temp directory."""
    return VaultManager(settings=tmp_loom_home)


@pytest.fixture()
def note_index() -> NoteIndex:
    """Return a fresh NoteIndex for testing."""
    return NoteIndex()


@pytest.fixture()
def client(vault_manager: VaultManager, note_index: NoteIndex) -> TestClient:
    """Return a test client with VaultManager and NoteIndex overridden."""
    app.dependency_overrides[get_vault_manager] = lambda: vault_manager
    app.dependency_overrides[get_note_index] = lambda: note_index
    yield TestClient(app)
    app.dependency_overrides.clear()


def _seed_notes(
    vault_manager: VaultManager,
    note_index: NoteIndex,
    notes: list[tuple[str, str, dict, str]],
) -> Path:
    """Helper to seed a vault with notes and build the index."""
    vault_manager.init_vault("test")
    vault_manager.set_active_vault("test")
    root = vault_manager._settings.vaults_dir / "test"
    threads = root / "threads"

    for folder, filename, meta, body in notes:
        d = threads / folder
        d.mkdir(parents=True, exist_ok=True)
        (d / filename).write_text(note_to_file_content(meta, body))

    # Build the index so routes can find notes
    note_index.build(threads)
    return root
