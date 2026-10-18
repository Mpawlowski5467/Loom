import io
import socket
import tarfile
from unittest.mock import patch

import pytest
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from core.clipper import MAX_BYTES, ClipError, _public_address, extract
from tests.conftest import _seed_notes


def pdf_bytes() -> bytes:
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})}
    )
    content = DecodedStreamObject()
    content.set_data(b"BT /F1 12 Tf 50 700 Td (The final decision is Friday.) Tj ET")
    page[NameObject("/Contents")] = writer._add_object(content)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


@pytest.mark.parametrize("address", ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "fc00::1"])
def test_private_network_urls_rejected(address):
    with (
        patch(
            "socket.getaddrinfo",
            return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 443))],
        ),
        pytest.raises(ClipError, match="network addresses"),
    ):
        _public_address("https://example.test/article")


def test_html_and_pdf_preserve_end_content_and_drop_scripts():
    text, title, extension = extract(
        b"<html><title>Decision</title><script>stealSecrets()</script><p>First fact</p><p>Final decision: Friday.</p></html>",
        "text/html",
    )
    assert "Final decision: Friday." in text
    assert "stealSecrets" not in text
    assert (title, extension) == ("Decision", "html")
    text, _, extension = extract(pdf_bytes(), "application/pdf")
    assert "final decision is Friday" in text
    assert extension == "pdf"


def test_bounds_and_scanned_pdf_explained():
    with pytest.raises(ClipError, match="8 MiB"):
        extract(b"a" * (MAX_BYTES + 1), "text/plain")
    writer = PdfWriter()
    writer.add_blank_page(width=10, height=10)
    output = io.BytesIO()
    writer.write(output)
    with pytest.raises(ClipError, match="OCR"):
        extract(output.getvalue(), "application/pdf")


def test_clipper_api_deduplicates_preserves_download_and_exports(
    client, vault_manager, note_index, tmp_path
):
    root = _seed_notes(vault_manager, note_index, [])
    raw = b"<title>Project status</title><p>The launch is Friday.</p>"
    with patch(
        "api.routers.imports.fetch_url",
        return_value=(raw, "text/html", "https://example.test/article"),
    ):
        response = client.post("/api/imports/url", json={"url": "https://example.test/article"})
        assert response.status_code == 201, response.text
        result = response.json()
        assert result["created"]
        assert "launch is Friday" in result["capture"]["body"]
        second = client.post(
            "/api/imports/url", json={"url": "https://example.test/article"}
        ).json()
        assert second["deduplicated"]
    filename = result["capture"]["provenance"]["original_file"].split("/")[-1]
    download = client.get(f"/api/imports/files/{filename}")
    assert download.content == raw
    assert "attachment" in download.headers["content-disposition"]
    from api.routers.vaults import _build_export_archive

    archive = _build_export_archive(root, "test", tmp_path)
    with tarfile.open(archive) as tar:
        assert tar.extractfile(f"test/attachments/{filename}").read() == raw
        assert "test/.loom/revisions.sqlite3" in tar.getnames()


def test_pdf_upload_is_real_and_failure_leaves_inbox_untouched(client, vault_manager, note_index):
    _seed_notes(vault_manager, note_index, [])
    response = client.post(
        "/api/imports/pdf?title=Decision",
        content=pdf_bytes(),
        headers={"Content-Type": "application/pdf"},
    )
    assert response.status_code == 201, response.text
    assert "final decision is Friday" in response.json()["capture"]["body"]
    before = client.get("/api/captures").json()
    assert client.post("/api/imports/pdf", content=b"not a pdf").status_code == 400
    assert client.get("/api/captures").json() == before


def test_vault_switch_during_extraction_never_files_into_new_vault(
    client, vault_manager, note_index
):
    _seed_notes(vault_manager, note_index, [])
    vault_manager.init_vault("another")

    def extraction(raw, content_type):
        vault_manager.set_active_vault("another")
        return "Source", "Title", "html"

    with (
        patch(
            "api.routers.imports.fetch_url",
            return_value=(b"source", "text/html", "https://example.test"),
        ),
        patch("api.routers.imports.extract", side_effect=extraction),
    ):
        response = client.post("/api/imports/url", json={"url": "https://example.test"})
    assert response.status_code == 409
    assert client.get("/api/captures").json() == []
