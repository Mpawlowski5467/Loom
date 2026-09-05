"""Canonical resolver parity across index, graph, and agent title maps."""

from pathlib import Path

from core.graph import build_graph
from core.note_index import NoteIndex
from core.notes import build_frontmatter


def _write(path: Path, note_id: str, title: str, **extra: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        build_frontmatter({"id": note_id, "title": title, "type": "topic", "tags": [], **extra})
        + "\nSee [[projects/atlas/roadmap#plan]].\n",
        encoding="utf-8",
    )


def test_resolves_slug_path_alias_and_heading_but_not_ambiguous_bare_title(tmp_path: Path) -> None:
    threads = tmp_path / "threads"
    roadmap = threads / "projects" / "atlas" / "roadmap.md"
    _write(roadmap, "thr_road", "Atlas Roadmap", aliases=["atlas-plan"])
    _write(threads / "topics" / "same-one.md", "thr_one", "Same")
    _write(threads / "projects" / "same-two.md", "thr_two", "Same")
    index = NoteIndex()
    index.build(threads)

    assert index.resolve_wikilink("roadmap").id == "thr_road"  # type: ignore[union-attr]
    assert index.resolve_wikilink("projects/atlas/roadmap#plan").id == "thr_road"  # type: ignore[union-attr]
    assert index.resolve_wikilink("atlas-plan").id == "thr_road"  # type: ignore[union-attr]
    assert index.resolve_wikilink("Same") is None

    graph = build_graph(threads)
    assert ("thr_road", "thr_road") not in {(edge.source, edge.target) for edge in graph.edges}
