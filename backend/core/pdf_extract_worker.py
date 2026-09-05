"""Isolated bounded PDF parser. Receives bytes on stdin and emits only JSON."""

import io
import json
import sys


def main() -> None:
    try:
        import resource

        resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
        if sys.platform != "darwin":
            resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    except (ImportError, ValueError, OSError):
        pass
    from pypdf import PdfReader

    raw = sys.stdin.buffer.read(8 * 1024 * 1024 + 1)
    if len(raw) > 8 * 1024 * 1024:
        raise ValueError("PDF exceeds byte limit")
    reader = PdfReader(io.BytesIO(raw), strict=True)
    if reader.is_encrypted or len(reader.pages) > 100:
        raise ValueError("Encrypted PDF or too many pages")
    pages = []
    total = 0
    for page in reader.pages:
        stream = page.get_contents()
        if stream and len(stream.get_data()) > 5 * 1024 * 1024:
            raise ValueError("PDF page content is too large")
        text = page.extract_text() or ""
        total += len(text)
        if total > 400_000:
            raise ValueError("PDF text exceeds limit")
        pages.append(text)
    title = str(reader.metadata.title or "") if reader.metadata else ""
    print(json.dumps({"text": "\n\n".join(pages), "title": title[:200]}))


if __name__ == "__main__":
    main()
