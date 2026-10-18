from core.notes import note_to_file_content
from tests.conftest import _seed_notes


def test_original_capture_survives_filing_and_skips_broken_archives(
    client, vault_manager, note_index
):
    original = "Beginning\n" + "source material\n" * 1500 + "UNIQUE_FINAL_REQUIREMENT"
    root = _seed_notes(
        vault_manager,
        note_index,
        [
            (
                "topics",
                "filed.md",
                {"id": "filed", "title": "Filed", "source": "capture:input"},
                "Summary",
            ),
        ],
    )
    archive = root / "threads/.archive/captures"
    archive.mkdir(parents=True)
    (archive / "a-broken.md").write_text("---\nbad: [\n---\n")
    (archive / "input.md").write_text(
        note_to_file_content(
            {"id": "input", "title": "Original", "type": "capture", "status": "archived"}, original
        )
    )
    response = client.get("/api/sources/filed")
    assert response.status_code == 200, response.text
    assert response.json()["body"] == original
    assert response.json()["id"] == "input"


def test_original_capture_does_not_follow_archive_symlinks(
    client, vault_manager, note_index, tmp_path
):
    root = _seed_notes(
        vault_manager,
        note_index,
        [
            (
                "topics",
                "filed.md",
                {"id": "filed", "title": "Filed", "source": "capture:input"},
                "Summary",
            ),
        ],
    )
    outside = tmp_path / "secret.md"
    outside.write_text(note_to_file_content({"id": "input", "type": "capture"}, "private"))
    archive = root / "threads/.archive"
    archive.mkdir(exist_ok=True)
    (archive / "input.md").symlink_to(outside)
    assert client.get("/api/sources/filed").status_code == 404
