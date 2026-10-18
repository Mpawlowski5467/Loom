"""Provider-free large-vault regression coverage."""

from pathlib import Path

from core.graph import build_graph
from core.note_index import NoteIndex
from core.notes import note_to_file_content


def test_thousand_note_index_and_graph(tmp_path: Path) -> None:
    threads = tmp_path / "threads"
    threads.mkdir()
    for index in range(1_000):
        link = f"\n\n[[note-{index - 1:04d}]]" if index else ""
        content = note_to_file_content(
            {
                "id": f"thr_{index:08d}",
                "title": f"Note {index:04d}",
                "type": "topic",
                "tags": ["scale", f"bucket-{index % 10}"],
                "created": "2026-01-01T00:00:00+00:00",
                "modified": "2026-01-01T00:00:00+00:00",
                "author": "user",
                "status": "active",
                "history": [],
            },
            f"# Note {index:04d}{link}",
        )
        (threads / f"note-{index:04d}.md").write_text(content, encoding="utf-8")

    note_index = NoteIndex()
    note_index.build(threads)
    graph = build_graph(threads)

    assert note_index.size == 1_000
    assert note_index.get_by_title("NOTE 0500") is not None
    assert note_index.get_tag_set() >= {"scale", "bucket-0", "bucket-9"}
    assert len(graph.nodes) == 1_000
    assert len(graph.edges) == 999
