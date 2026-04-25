"""Path-traversal regressions for vault-bound API routes.

These tests ensure user-supplied path components cannot escape the
active vault. See ``backend/core/vault.py`` for the validation helpers.
"""

import pytest
from starlette.testclient import TestClient

from core.vault import VaultManager, VaultPathError
from tests.conftest import _seed_notes


@pytest.fixture()
def initialized_vault(vault_manager: VaultManager, note_index) -> VaultManager:
    """Initialize an empty vault so vault_dir / threads_dir exist."""
    _seed_notes(vault_manager, note_index, [])
    return vault_manager


# -- Direct VaultManager validators ------------------------------------------


class TestVaultManagerValidators:
    """Unit tests for the validation helpers."""

    def test_validate_agent_name_accepts_known(self) -> None:
        for name in ("weaver", "spider", "researcher", "_council"):
            assert VaultManager.validate_agent_name(name) == name

    def test_validate_agent_name_rejects_traversal(self) -> None:
        for bad in ("../etc", "..", "weaver/../../etc", "/etc/passwd", ""):
            with pytest.raises(VaultPathError):
                VaultManager.validate_agent_name(bad)

    def test_validate_date_accepts_iso(self) -> None:
        assert VaultManager.validate_date("2026-04-24") == "2026-04-24"

    def test_validate_date_rejects_traversal(self) -> None:
        for bad in ("../../passwd", "2026/04/24", "2026-04-24.md", "../2026-04-24"):
            with pytest.raises(VaultPathError):
                VaultManager.validate_date(bad)

    def test_resolve_capture_path_rejects_absolute_outside(
        self, initialized_vault: VaultManager
    ) -> None:
        with pytest.raises(VaultPathError):
            initialized_vault.resolve_capture_path("/etc/passwd")

    def test_resolve_capture_path_rejects_relative_traversal(
        self, initialized_vault: VaultManager
    ) -> None:
        with pytest.raises(VaultPathError):
            initialized_vault.resolve_capture_path("../../outside.md")

    def test_resolve_capture_path_rejects_non_md(
        self, initialized_vault: VaultManager
    ) -> None:
        with pytest.raises(VaultPathError):
            initialized_vault.resolve_capture_path("captures/raw.txt")

    def test_resolve_capture_path_accepts_valid_relative(
        self, initialized_vault: VaultManager
    ) -> None:
        # File doesn't have to exist; we only check the boundary
        result = initialized_vault.resolve_capture_path("captures/raw-idea.md")
        threads_dir = initialized_vault.active_threads_dir().resolve()
        assert result.is_relative_to(threads_dir)


# -- Route-level regressions --------------------------------------------------


class TestChangelogRouteTraversal:
    """``GET /api/changelog`` must reject malicious agent / date params."""

    def test_traversal_in_agent(
        self, client: TestClient, initialized_vault: VaultManager
    ) -> None:
        r = client.get("/api/changelog", params={"agent": "../../etc", "date": "2026-04-24"})
        assert r.status_code == 400

    def test_traversal_in_date(
        self, client: TestClient, initialized_vault: VaultManager
    ) -> None:
        r = client.get("/api/changelog", params={"agent": "weaver", "date": "../../passwd"})
        assert r.status_code == 400

    def test_unknown_agent(
        self, client: TestClient, initialized_vault: VaultManager
    ) -> None:
        r = client.get("/api/changelog", params={"agent": "evil", "date": "2026-04-24"})
        assert r.status_code == 400


class TestChatHistoryRouteTraversal:
    """``GET /api/chat/history/{date_str}`` must reject malicious params.

    Note: Starlette normalizes ``..`` in URL paths before routing, so the
    most realistic attack surface here is the ``agent`` query parameter
    and arbitrary date strings reaching the validator.
    """

    def test_invalid_date_format(
        self, client: TestClient, initialized_vault: VaultManager
    ) -> None:
        r = client.get("/api/chat/history/notadate")
        assert r.status_code == 400

    def test_date_with_extension(
        self, client: TestClient, initialized_vault: VaultManager
    ) -> None:
        r = client.get("/api/chat/history/2026-04-24.md")
        assert r.status_code == 400

    def test_invalid_agent(
        self, client: TestClient, initialized_vault: VaultManager
    ) -> None:
        r = client.get("/api/chat/history/2026-04-24", params={"agent": "../../etc"})
        assert r.status_code == 400


class TestCapturesProcessRouteTraversal:
    """``POST /api/captures/process`` must refuse paths outside the vault."""

    def test_absolute_path_outside_vault(
        self, client: TestClient, initialized_vault: VaultManager
    ) -> None:
        r = client.post("/api/captures/process", json={"capture_path": "/etc/passwd"})
        assert r.status_code == 400

    def test_relative_traversal(
        self, client: TestClient, initialized_vault: VaultManager
    ) -> None:
        r = client.post(
            "/api/captures/process", json={"capture_path": "../../etc/shadow.md"}
        )
        assert r.status_code == 400

    def test_non_markdown_extension(
        self, client: TestClient, initialized_vault: VaultManager
    ) -> None:
        r = client.post("/api/captures/process", json={"capture_path": "captures/x.txt"})
        assert r.status_code == 400
