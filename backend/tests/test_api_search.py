"""Tests for the search API route."""

from pathlib import Path

import pytest
from starlette.testclient import TestClient

from tests.conftest import _seed_notes

_NOTES = [
    ("topics", "rust.md", {
        "id": "thr_aaa111",
        "title": "Rust Language",
        "type": "topic",
        "tags": ["programming", "systems"],
    }, "## Overview\n\nA memory-safe systems language.\n"),
    ("topics", "python.md", {
        "id": "thr_bbb222",
        "title": "Python",
        "type": "topic",
        "tags": ["programming", "scripting"],
    }, "## Overview\n\nA dynamic language for everything.\n"),
    ("projects", "loom.md", {
        "id": "thr_ccc333",
        "title": "Loom Project",
        "type": "project",
        "tags": ["ai", "rust"],
    }, "## About\n\nUses Rust and Python together.\n"),
]


@pytest.fixture()
def seeded_vault(vault_manager, note_index):
    """Create a vault with test notes for searching."""
    return _seed_notes(vault_manager, note_index, _NOTES)


def test_search_by_title(client: TestClient, seeded_vault: Path) -> None:
    resp = client.get("/api/search?q=Rust")
    assert resp.status_code == 200
    data = resp.json()
    assert data["query"] == "Rust"
    # "Rust Language" should be the top result (title match = highest score)
    assert len(data["results"]) >= 1
    assert data["results"][0]["title"] == "Rust Language"


def test_search_by_tag(client: TestClient, seeded_vault: Path) -> None:
    resp = client.get("/api/search?q=programming")
    data = resp.json()
    titles = {r["title"] for r in data["results"]}
    assert "Rust Language" in titles
    assert "Python" in titles


def test_search_by_body(client: TestClient, seeded_vault: Path) -> None:
    resp = client.get("/api/search?q=memory-safe")
    data = resp.json()
    assert len(data["results"]) == 1
    assert data["results"][0]["id"] == "thr_aaa111"


def test_search_no_results(client: TestClient, seeded_vault: Path) -> None:
    resp = client.get("/api/search?q=nonexistent")
    data = resp.json()
    assert len(data["results"]) == 0


def test_search_empty_query(client: TestClient, seeded_vault: Path) -> None:
    resp = client.get("/api/search?q=")
    assert resp.status_code == 422  # validation error: min_length=1


def test_search_snippet(client: TestClient, seeded_vault: Path) -> None:
    resp = client.get("/api/search?q=dynamic")
    data = resp.json()
    assert len(data["results"]) == 1
    assert "dynamic" in data["results"][0]["snippet"].lower()
