from pathlib import Path

from core.note_index import NoteIndex
from core.notes import note_to_file_content


def _write(root: Path, note_id: str, body: str, tags: list[str]) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    path = root / f"{note_id}.md"
    path.write_text(
        note_to_file_content({"id": note_id, "title": note_id, "type": "topic", "tags": tags}, body)
    )
    return path


def test_fts_matches_separate_query_terms_and_filters_before_limit(tmp_path):
    threads = tmp_path / "threads"
    for i in range(100):
        _write(threads, f"noise-{i}", "launch schedule", ["noise"])
    _write(threads, "wanted", "The launch is Friday. A revised schedule follows.", ["important"])
    index = NoteIndex()
    index.build(threads)
    found = index.lexical_search("launch schedule", tags=["important"], limit=1)
    assert [entry.id for entry, _ in found] == ["wanted"]


def test_fts_refresh_removal_rebuild_and_queries_need_no_filesystem_read(tmp_path, monkeypatch):
    threads = tmp_path / "threads"
    path = _write(threads, "one", "original astronomy", [])
    index = NoteIndex()
    index.build(threads)
    assert index.lexical_search("astro")
    with monkeypatch.context() as context:
        context.setattr(
            Path,
            "read_text",
            lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("query read file")),
        )
        assert index.lexical_search("astronomy")
    _write(threads, "one", "replacement biology", [])
    index.refresh_file(path)
    assert not index.lexical_search("astronomy")
    assert index.lexical_search("biology")
    index.remove_file(path)
    assert not index.lexical_search("biology")
    index.build(threads)
    assert index.lexical_search("biology")
    index.build(tmp_path / "missing")
    assert not index.lexical_search("biology")
