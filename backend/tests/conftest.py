"""Shared test fixtures."""

from pathlib import Path

import pytest
from starlette.testclient import TestClient

from api.main import app
from core.config import LoomSettings
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
def client(vault_manager: VaultManager) -> TestClient:
    """Return a test client with VaultManager dependency overridden."""
    app.dependency_overrides[get_vault_manager] = lambda: vault_manager
    yield TestClient(app)
    app.dependency_overrides.clear()
