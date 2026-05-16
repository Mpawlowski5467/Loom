"""Tests for core.graph — graph building from vault notes."""

from pathlib import Path

from core.graph import build_graph, load_graph, save_graph
from core.notes import note_to_file_content


def _write_note(threads: Path, folder: str, filename: str, meta: dict, body: str) -> Path:
    d = threads / folder
    d.mkdir(parents=True, exist_ok=True)
    p = d / filename
    p.write_text(note_to_file_content(meta, body))
    return p


def test_build_graph_with_wikilinks(tmp_path: Path) -> None:
    threads = tmp_path / "threads"

    _write_note(
        threads,
        "topics",
        "python.md",
        {
            "id": "thr_aaa111",
            "title": "Python",
            "type": "topic",
            "tags": ["lang"],
        },
        "## About\n\nSee also [[FastAPI]].\n",
    )

    _write_note(
        threads,
        "topics",
        "fastapi.md",
        {
            "id": "thr_bbb222",
            "title": "FastAPI",
            "type": "topic",
            "tags": ["web", "python"],
        },
        "## About\n\nBuilt on [[Python]].\n",
    )

    _write_note(
        threads,
        "projects",
        "loom.md",
        {
            "id": "thr_ccc333",
            "title": "Loom",
            "type": "project",
            "tags": ["ai"],
        },
        "## About\n\nUses [[Python]] and [[FastAPI]].\n",
    )

    graph = build_graph(threads)
    assert len(graph.nodes) == 3
    assert len(graph.edges) == 4

    ids = {n.id for n in graph.nodes}
    assert ids == {"thr_aaa111", "thr_bbb222", "thr_ccc333"}

    edge_pairs = {(e.source, e.target) for e in graph.edges}
    assert ("thr_aaa111", "thr_bbb222") in edge_pairs
    assert ("thr_bbb222", "thr_aaa111") in edge_pairs
    assert ("thr_ccc333", "thr_aaa111") in edge_pairs
    assert ("thr_ccc333", "thr_bbb222") in edge_pairs


def test_save_and_load_graph(tmp_path: Path) -> None:
    threads = tmp_path / "threads"

    _write_note(
        threads,
        "topics",
        "one.md",
        {
            "id": "thr_111111",
            "title": "One",
            "type": "topic",
            "tags": [],
        },
        "Body.\n",
    )

    graph = build_graph(threads)
    loom_dir = tmp_path / ".loom"
    save_graph(graph, loom_dir)

    loaded = load_graph(loom_dir)
    assert loaded is not None
    assert len(loaded.nodes) == 1
    assert loaded.nodes[0].id == "thr_111111"


def test_build_graph_excludes_archive(tmp_path: Path) -> None:
    threads = tmp_path / "threads"

    _write_note(
        threads,
        "topics",
        "active.md",
        {
            "id": "thr_act111",
            "title": "Active",
            "type": "topic",
            "tags": [],
        },
        "Body.\n",
    )

    _write_note(
        threads,
        ".archive",
        "old.md",
        {
            "id": "thr_old111",
            "title": "Old",
            "type": "topic",
            "tags": [],
        },
        "Archived.\n",
    )

    graph = build_graph(threads)
    assert len(graph.nodes) == 1
    assert graph.nodes[0].id == "thr_act111"
