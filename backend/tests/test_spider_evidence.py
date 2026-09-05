from __future__ import annotations

from pathlib import Path

import pytest

from agents.loom.spider_linker import apply_links, persist_suggestions
from agents.loom.spider_models import LinkCandidate
from core.notes import now_iso, parse_note
from core.traces import clear_run, set_run


def _note(root: Path, name: str, note_id: str, title: str, body: str = "") -> Path:
    path = root / "threads" / "topics" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    ts = now_iso()
    path.write_text(
        f"---\nid: {note_id}\ntitle: {title}\ntype: topic\ntags: []\ncreated: {ts}\nmodified: {ts}\nauthor: user\nstatus: active\nhistory: []\n---\n{body}"
    )
    return path


@pytest.mark.asyncio
async def test_applied_evidence_survives_suggestions_and_records_run(tmp_path: Path) -> None:
    root = tmp_path / "vault"
    source_path = _note(root, "source.md", "src", "Source", "source text")
    target_path = _note(root, "target.md", "tgt", "Target", "target text")
    source = parse_note(source_path)
    set_run("run-applied")
    assert await apply_links(root, source_path, source, ["Target"]) == ["Target"]
    set_run("run-suggested")
    await persist_suggestions(
        root,
        source_path,
        parse_note(source_path),
        [
            LinkCandidate(
                note_id="tgt", title="Target", score=0.6, decision="suggested", reason="review"
            )
        ],
    )
    clear_run()
    evidence = parse_note(source_path).extra["link_evidence"]
    assert {item["state"] for item in evidence} == {"applied", "suggested"}
    assert {item["run_id"] for item in evidence} == {"run-applied", "run-suggested"}
    assert target_path.exists()


@pytest.mark.asyncio
async def test_ambiguous_bare_slug_is_not_treated_as_existing_target(tmp_path: Path) -> None:
    root = tmp_path / "vault"
    source_path = _note(root, "source.md", "src", "Source", "[[same]]")
    _note(root, "one.md", "one", "Same", "one")
    _note(root, "two.md", "two", "Same", "two")
    # Ambiguous `same` resolves to no arbitrary path, so neither target is
    # silently considered linked and applying by ambiguous title is skipped.
    assert await apply_links(root, source_path, parse_note(source_path), ["Same"]) == []
