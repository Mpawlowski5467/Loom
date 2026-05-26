"""Tests for the graph API route in api/routers/graph.py."""

from pathlib import Path

import pytest
from starlette.testclient import TestClient

from tests.conftest import _seed_notes

_LINKED_NOTES = [
    (
        "topics",
        "python.md",
        {
            "id": "thr_gra001",
            "title": "Python",
            "type": "topic",
            "tags": ["lang", "test"],
            "created": "2026-01-01T00:00:00+00:00",
            "modified": "2026-01-01T00:00:00+00:00",
            "author": "user",
            "status": "active",
            "history": [],
        },
        "## About\n\nSee also [[FastAPI]] and [[Django]].\n",
    ),
    (
        "topics",
        "fastapi.md",
        {
            "id": "thr_gra002",
            "title": "FastAPI",
            "type": "topic",
            "tags": ["web"],
            "created": "2026-01-01T00:00:00+00:00",
            "modified": "2026-01-01T00:00:00+00:00",
            "author": "user",
            "status": "active",
            "history": [],
        },
        "## About\n\nBuilt on [[Python]].\n",
    ),
    (
        "projects",
        "loom-project.md",
        {
            "id": "thr_gra003",
            "title": "Loom Project",
            "type": "project",
            "tags": ["ai", "test"],
            "created": "2026-01-01T00:00:00+00:00",
            "modified": "2026-01-01T00:00:00+00:00",
            "author": "user",
            "status": "active",
            "history": [],
        },
        "## About\n\nUses [[Python]] and [[FastAPI]].\n",
    ),
]


@pytest.fixture()
def seeded_graph_vault(vault_manager, note_index):
    """Create a vault with linked notes for graph tests."""
    return _seed_notes(vault_manager, note_index, _LINKED_NOTES)


@pytest.fixture()
def empty_vault(vault_manager, note_index):
    """Create an empty vault."""
    return _seed_notes(vault_manager, note_index, [])


# ---------------------------------------------------------------------------
# GET /api/graph — full graph
# ---------------------------------------------------------------------------


class TestGetGraph:
    def test_graph_with_seeded_notes(self, client: TestClient, seeded_graph_vault: Path) -> None:
        """GET /api/graph returns nodes and edges from seeded notes."""
        resp = client.get("/api/graph")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["nodes"]) == 3
        # Edges: Python->FastAPI, Python->Django(missing, so no edge),
        #        FastAPI->Python, LoomProject->Python, LoomProject->FastAPI
        # Django doesn't exist so wikilink doesn't resolve.
        assert len(data["edges"]) >= 3

    def test_node_structure(self, client: TestClient, seeded_graph_vault: Path) -> None:
        """Each graph node has required id, title, type fields."""
        resp = client.get("/api/graph")
        data = resp.json()
        for node in data["nodes"]:
            assert "id" in node
            assert "title" in node
            assert "type" in node
            assert "tags" in node
            assert node["id"].startswith("thr_")

    def test_edges_connect_valid_node_ids(
        self, client: TestClient, seeded_graph_vault: Path
    ) -> None:
        """Every edge source and target must be a valid node id."""
        resp = client.get("/api/graph")
        data = resp.json()
        node_ids = {n["id"] for n in data["nodes"]}
        for edge in data["edges"]:
            assert edge["source"] in node_ids, f"Invalid source: {edge['source']}"
            assert edge["target"] in node_ids, f"Invalid target: {edge['target']}"

    def test_empty_vault_returns_empty_graph(self, client: TestClient, empty_vault: Path) -> None:
        """GET /api/graph with no notes returns empty nodes and edges."""
        resp = client.get("/api/graph")
        assert resp.status_code == 200
        data = resp.json()
        assert data["nodes"] == []
        assert data["edges"] == []

    def test_dirty_flag_triggers_rebuild(
        self, client: TestClient, seeded_graph_vault: Path
    ) -> None:
        """When the dirty marker is set, the next GET rebuilds and clears it.

        Simulates: agent writes a note → mark_dirty() → user opens the graph
        view → fresh graph is served, not the cached stale one.
        """
        from core.graph_state import is_dirty, mark_dirty

        # Prime the cache.
        client.get("/api/graph")

        loom_dir = seeded_graph_vault / ".loom"
        assert loom_dir.is_dir()

        # Add a new note directly on disk to mimic an out-of-band write
        # (e.g., a CLI script) — without marking dirty, the API would
        # happily serve its stale cached graph.
        new_note = seeded_graph_vault / "threads" / "topics" / "rust.md"
        new_note.write_text(
            "---\n"
            "id: thr_gra999\n"
            'title: "Rust"\n'
            "type: topic\n"
            "tags: [lang]\n"
            'created: "2026-01-01T00:00:00+00:00"\n'
            'modified: "2026-01-01T00:00:00+00:00"\n'
            "author: user\n"
            "status: active\n"
            "history: []\n"
            "---\n\n## About\n\nA systems lang.\n",
            encoding="utf-8",
        )

        # Without dirty, cached graph still has 3 nodes.
        before = client.get("/api/graph").json()
        assert len(before["nodes"]) == 3

        # Mark dirty → next read should rebuild and pick up the new note.
        mark_dirty(loom_dir)
        assert is_dirty(loom_dir) is True

        after = client.get("/api/graph").json()
        assert len(after["nodes"]) == 4
        assert any(n["id"] == "thr_gra999" for n in after["nodes"])
        # Flag should be cleared after the rebuild.
        assert is_dirty(loom_dir) is False


# ---------------------------------------------------------------------------
# GET /api/graph — filtering
# ---------------------------------------------------------------------------


class TestGetGraphFiltered:
    def test_filter_by_type(self, client: TestClient, seeded_graph_vault: Path) -> None:
        """GET /api/graph?type=topic returns only topic nodes."""
        resp = client.get("/api/graph?type=topic")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["nodes"]) == 2
        assert all(n["type"] == "topic" for n in data["nodes"])

    def test_filter_by_type_project(self, client: TestClient, seeded_graph_vault: Path) -> None:
        """GET /api/graph?type=project returns only project nodes."""
        resp = client.get("/api/graph?type=project")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["nodes"]) == 1
        assert data["nodes"][0]["type"] == "project"
        # Single node, no edges between projects
        assert len(data["edges"]) == 0

    def test_filter_by_tag(self, client: TestClient, seeded_graph_vault: Path) -> None:
        """GET /api/graph?tag=test returns nodes tagged with 'test'."""
        resp = client.get("/api/graph?tag=test")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["nodes"]) == 2
        node_ids = {n["id"] for n in data["nodes"]}
        assert "thr_gra001" in node_ids  # Python (tagged test)
        assert "thr_gra003" in node_ids  # Loom Project (tagged test)

    def test_filter_by_tag_keeps_valid_edges(
        self, client: TestClient, seeded_graph_vault: Path
    ) -> None:
        """Filtered edges only connect nodes that survived the filter."""
        resp = client.get("/api/graph?tag=test")
        data = resp.json()
        node_ids = {n["id"] for n in data["nodes"]}
        for edge in data["edges"]:
            assert edge["source"] in node_ids
            assert edge["target"] in node_ids

    def test_filter_nonexistent_type_returns_empty(
        self, client: TestClient, seeded_graph_vault: Path
    ) -> None:
        """GET /api/graph?type=person with no person notes returns empty."""
        resp = client.get("/api/graph?type=person")
        assert resp.status_code == 200
        data = resp.json()
        assert data["nodes"] == []
        assert data["edges"] == []

    def test_filter_nonexistent_tag_returns_empty(
        self, client: TestClient, seeded_graph_vault: Path
    ) -> None:
        """GET /api/graph?tag=nonexistent returns empty."""
        resp = client.get("/api/graph?tag=nonexistent")
        assert resp.status_code == 200
        data = resp.json()
        assert data["nodes"] == []
        assert data["edges"] == []
