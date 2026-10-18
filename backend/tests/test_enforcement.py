"""Tests for the shared Sentinel-verdict enforcement logic.

``enforce_verdict`` is the single implementation behind both the capture
pipeline graph and the ``/api/captures/commit`` endpoint, so its three outcomes
(passed/warning/failed) are worth pinning directly.
"""

from pathlib import Path

import pytest

from agents.loom import enforcement
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


def _write_note(
    path: Path, note_id: str, title: str, source: str, note_type: str = "topic"
) -> None:
    ts = now_iso()
    meta = {
        "id": note_id,
        "title": title,
        "type": note_type,
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
    _write_note(capture, "thr_cap001", "Cap", "manual", note_type="capture")
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
    # Note carries the final clean lifecycle state.
    note_extra = parse_note(note).extra
    assert note_extra.get("enforcement_outcome") == "filed"
    assert note_extra.get("validation") == "passed"
    assert note_extra.get("review_required") is False
    assert note_extra.get("review_reasons") == []
    assert note_extra.get("flagged") is False
    assert note_extra.get("flag_reasons") == []


def test_failed_keeps_capture_and_marks_review_required(
    vault_with_capture: tuple[Path, Path, Path],
) -> None:
    root, capture, note = vault_with_capture

    outcome = enforce_verdict(root, capture, note, "failed", ["missing summary"])

    assert outcome.review_required is True
    assert outcome.capture_archived is False
    # Capture stays in the inbox, flagged for review.
    assert capture.exists()
    capture_extra = parse_note(capture).extra
    assert capture_extra.get("review_required") is True
    assert capture_extra.get("draft_note_id") == "thr_note01"
    assert capture_extra.get("draft_note_path") == str(note)
    note_extra = parse_note(note).extra
    assert note_extra.get("review_required") is True
    assert note_extra.get("review_reasons") == ["missing summary"]
    assert note_extra.get("publication_state") == "rejected"


def test_failed_then_passed_retry_clears_stale_note_review_state(
    vault_with_capture: tuple[Path, Path, Path],
) -> None:
    root, capture, note = vault_with_capture

    first = enforce_verdict(
        root,
        capture,
        note,
        "failed",
        ["missing summary"],
        validation_mode="deterministic",
    )
    assert first.review_required is True
    assert parse_note(note).extra.get("enforcement_outcome") == "needs_review"

    retried = enforce_verdict(
        root,
        capture,
        note,
        "passed",
        [],
        validation_mode="llm",
    )

    assert retried.capture_archived is True
    assert retried.review_required is False
    note_extra = parse_note(note).extra
    assert note_extra.get("enforcement_outcome") == "filed"
    assert note_extra.get("validation") == "passed"
    assert note_extra.get("validation_mode") == "llm"
    assert note_extra.get("validation_reasons") == []
    assert note_extra.get("review_required") is False
    assert note_extra.get("review_reasons") == []
    assert note_extra.get("flagged") is False
    assert note_extra.get("flag_reasons") == []
    assert note_extra.get("publication_state") == "published"


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


def test_publication_annotation_failure_restores_exact_inbox_capture(
    vault_with_capture: tuple[Path, Path, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    """A failed publication commit cannot leave an accepted capture only in archive."""
    root, capture, note = vault_with_capture
    original_capture = capture.read_text(encoding="utf-8")
    note.write_text(
        note.read_text(encoding="utf-8").replace(
            "status: active", "status: active\npublication_state: pending"
        ),
        encoding="utf-8",
    )
    annotate = enforcement.annotate_frontmatter

    def fail_publication(
        vault_dir: Path, path: Path, fields: dict[str, object], *, strict: bool = False
    ) -> bool:
        if strict and path == note:
            raise OSError("disk full")
        return annotate(vault_dir, path, fields, strict=strict)

    monkeypatch.setattr(enforcement, "annotate_frontmatter", fail_publication)

    # Coverage is stamped pre-move; recovery must still restore pristine bytes.
    outcome = enforce_verdict(root, capture, note, "passed", [], source_coverage={"complete": True})

    assert outcome.capture_archived is False
    assert outcome.review_required is True
    assert outcome.flagged is False
    assert any("Publication could not be completed" in reason for reason in outcome.reasons)
    assert capture.read_text(encoding="utf-8") == original_capture
    assert not (root / "threads" / ".archive" / "cap.md").exists()
    # The failed draft remains unpublished; a refresh removes it from retrieval.
    assert parse_note(note).extra.get("publication_state") == "pending"
    changelog = next((root / ".loom" / "changelog" / "weaver").glob("*.md"))
    assert "Publication could not be completed" in changelog.read_text(encoding="utf-8")


@pytest.mark.parametrize(
    ("verdict", "location"),
    [("passed", ".archive"), ("warning", ".archive"), ("failed", "captures")],
)
def test_source_coverage_is_stamped_on_the_capture_before_any_move(
    vault_with_capture: tuple[Path, Path, Path],
    caplog: pytest.LogCaptureFixture,
    verdict: str,
    location: str,
) -> None:
    """The capture keeps its coverage wherever enforcement leaves it."""
    root, capture, note = vault_with_capture
    coverage = {"complete": True, "source_link": "manual"}

    enforce_verdict(root, capture, note, verdict, ["r"], source_coverage=coverage)

    assert not any("Failed to annotate" in r.getMessage() for r in caplog.records)
    stored = parse_note(root / "threads" / location / "cap.md")
    assert stored.extra.get("source_coverage") == coverage


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
