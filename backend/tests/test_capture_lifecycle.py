from core.capture_lifecycle import archive_capture, capture_vault_root
from core.notes import note_to_file_content, parse_note


def test_nested_capture_archive_keeps_original_destination(tmp_path):
    root = tmp_path / "vault"
    path = root / "threads/captures/imported/input.md"
    path.parent.mkdir(parents=True)
    path.write_text(note_to_file_content({"id": "nested", "type": "capture"}, "Original source"))
    assert capture_vault_root(path) == root
    destination = archive_capture(root, path, by="user", reason="Reviewed")
    assert capture_vault_root(path) == root  # durable job finalization works after the move
    assert parse_note(destination).extra["archive_original_path"] == "captures/imported/input.md"
    assert not path.exists()
