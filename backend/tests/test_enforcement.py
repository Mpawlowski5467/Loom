"""Tests for the shared Sentinel-verdict enforcement logic.

``enforce_verdict`` is the single implementation behind both the capture
pipeline graph and the ``/api/captures/commit`` endpoint, so its three outcomes
(passed/warning/failed) are worth pinning directly.
"""

from pathlib import Path

import pytest

from agents.loom.enforcement import enforce_verdict
from core.notes import note_to_file_content, now_iso, parse_note


def _build_vault(tmp_path: Path) -> Path:
    """Create the minimal vault tree enforce_verdict touches."""
    root = tmp_path / "vault"
    (root / "threads" / "captures").mkdir(parents=True)
    (root / "threads" / "topics").mkdir(parents=True)
    (root / "rules").mkdir(parents=True)
    (root / "rules" / "prime.md").write_text("# Prime\n", encoding="utf-8")
    (root / ".loom" / "changelog" / "weaver").mkdir(parents=True)
    return root


def _write_note(path: Path, note_id: str, title: str, source: str) -> None:
    ts = now_iso()
    meta = {
        "id": note_id,
        "title": title,
        "type": "topic",
        "tags": [],
        "created": ts,
        "modified": ts,
        "author": "agent:weaver",
        "source": source,
        "links": [],
        "status": "active",
        "history": [],
    }
    path.write_text(note_to_file_content(meta, "## Summary\n\nBody.\n"), encoding="utf-8")


@pytest.fixture()
def vault_with_capture(tmp_path: Path) -> tuple[Path, Path, Path]:
    root = _build_vault(tmp_path)
    capture = root / "threads" / "captures" / "cap.md"
    note = root / "threads" / "topics" / "note.md"
    _write_note(capture, "thr_cap001", "Cap", "manual")
    _write_note(note, "thr_note01", "Note", "capture:thr_cap001")
    return root, capture, note


def test_passed_archives_capture_and_ships_note_clean(
    vault_with_capture: tuple[Path, Path, Path],
) -> None:
    root, capture, note = vault_with_capture

    outcome = enforce_verdict(root, capture, note, "passed", [])

    assert outcome.capture_archived is True
    assert outcome.review_required is False
    assert outcome.flagged is False
    # Capture moved out of the inbox into .archive/.
    assert not capture.exists()
    assert (root / "threads" / ".archive" / "cap.md").exists()
    # Note untouched by flags.
    parsed = parse_note(note)
    assert "review_required" not in parsed.extra
    assert "flagged" not in parsed.extra


def test_failed_keeps_capture_and_marks_review_required(
    vault_with_capture: tuple[Path, Path, Path],
) -> None:
    root, capture, note = vault_with_capture

    outcome = enforce_verdict(root, capture, note, "failed", ["missing summary"])

    assert outcome.review_required is True
    assert outcome.capture_archived is False
    # Capture stays in the inbox, flagged for review.
    assert capture.exists()
    assert parse_note(capture).extra.get("review_required") is True
    note_extra = parse_note(note).extra
    assert note_extra.get("review_required") is True
    assert note_extra.get("review_reasons") == ["missing summary"]


def test_warning_archives_capture_and_flags_note(
    vault_with_capture: tuple[Path, Path, Path],
) -> None:
    root, capture, note = vault_with_capture

    outcome = enforce_verdict(root, capture, note, "warning", ["thin content"])

    assert outcome.flagged is True
    assert outcome.capture_archived is True
    assert not capture.exists()
    note_extra = parse_note(note).extra
    assert note_extra.get("flagged") is True
    assert note_extra.get("flag_reasons") == ["thin content"]


@pytest.mark.parametrize("verdict", ["", "unavailable", "bogus"])
def test_unknown_verdict_fails_closed_and_marks_review_required(
    vault_with_capture: tuple[Path, Path, Path], verdict: str
) -> None:
    root, capture, note = vault_with_capture

    outcome = enforce_verdict(root, capture, note, verdict, [])

    assert outcome.review_required is True
    assert outcome.capture_archived is False
    assert outcome.flagged is False
    assert capture.exists()
    assert not (root / "threads" / ".archive" / "cap.md").exists()
    assert parse_note(capture).extra.get("review_required") is True
    note_extra = parse_note(note).extra
    assert note_extra.get("review_required") is True
    assert note_extra.get("review_reasons")


def test_annotation_preserves_unknown_user_frontmatter(
    vault_with_capture: tuple[Path, Path, Path],
) -> None:
    """A user's custom frontmatter key survives a Sentinel annotation."""
    root, capture, note = vault_with_capture
    # Inject a custom field the model doesn't know about.
    text = note.read_text(encoding="utf-8")
    note.write_text(text.replace("status: active", "status: active\npriority: high"), "utf-8")

    enforce_verdict(root, capture, note, "failed", ["x"])

    parsed = parse_note(note)
    assert parsed.extra.get("priority") == "high"
    assert parsed.extra.get("review_required") is True
