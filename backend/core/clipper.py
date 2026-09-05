"""Bounded public URL fetching and local extraction; original bytes are retained."""

from __future__ import annotations

import hashlib
import http.client
import ipaddress
import json
import os
import re
import socket
import ssl
import subprocess
import sys
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit

MAX_BYTES = 8 * 1024 * 1024
MAX_TEXT = 400_000


class ClipError(ValueError):
    """An unsupported or oversized source, reported without a partial capture."""


def _public_address(url: str) -> tuple[str, str, int, str]:
    try:
        parts = urlsplit(url)
        if (
            parts.scheme not in {"http", "https"}
            or not parts.hostname
            or parts.username
            or parts.password
        ):
            raise ClipError("Use a public HTTP or HTTPS URL without credentials")
        host = parts.hostname.encode("idna").decode("ascii")
        port = parts.port or (443 if parts.scheme == "https" else 80)
        if port not in {80, 443}:
            raise ClipError("Only public web ports 80 and 443 are supported")
        addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        if not addresses or any(
            not ipaddress.ip_address(item[4][0]).is_global for item in addresses
        ):
            raise ClipError("Private, loopback and reserved network addresses cannot be clipped")
        normalized = urlunsplit((parts.scheme, parts.netloc, parts.path or "/", parts.query, ""))
        return normalized, host, port, str(addresses[0][4][0])
    except (ValueError, OSError) as exc:
        if isinstance(exc, ClipError):
            raise
        raise ClipError("The URL could not be resolved as a public website") from exc


def fetch_url(url: str) -> tuple[bytes, str, str]:
    """Resolve/validate every redirect, pin the TCP address, and verify TLS hostname."""
    deadline = time.monotonic() + 30
    for _ in range(4):
        url, host, port, address = _public_address(url)
        parts = urlsplit(url)
        timeout = min(8.0, deadline - time.monotonic())
        if timeout <= 0:
            raise ClipError("Website exceeded the 30 second fetch limit")
        connection = http.client.HTTPConnection(host, port, timeout=timeout)
        sock = socket.create_connection((address, port), timeout=timeout)
        try:
            if parts.scheme == "https":
                sock = ssl.create_default_context().wrap_socket(sock, server_hostname=host)
            connection.sock = sock
            path = urlunsplit(("", "", parts.path or "/", parts.query, ""))
            connection.request(
                "GET",
                path,
                headers={
                    "User-Agent": "Loom-Clipper/1.0",
                    "Accept-Encoding": "identity",
                    "Accept": "text/html,text/plain,application/pdf",
                },
            )
            response = connection.getresponse()
            if response.status in {301, 302, 303, 307, 308}:
                location = response.getheader("Location")
                if not location:
                    raise ClipError("Website returned an empty redirect")
                url = urljoin(url, location)
                continue
            if response.status != 200:
                raise ClipError(f"Website returned HTTP {response.status}")
            if response.getheader("Content-Encoding", "identity").lower() != "identity":
                raise ClipError("Compressed responses are not supported by this clipper")
            raw_length = response.getheader("Content-Length", "")
            if raw_length.isdigit() and int(raw_length) > MAX_BYTES:
                raise ClipError("Source exceeds the 8 MiB import limit")
            chunks: list[bytes] = []
            size = 0
            while True:
                if time.monotonic() >= deadline:
                    raise ClipError("Website exceeded the 30 second fetch limit")
                chunk = response.read(min(65_536, MAX_BYTES + 1 - size))
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_BYTES:
                    raise ClipError("Source exceeds the 8 MiB import limit")
                chunks.append(chunk)
            return b"".join(chunks), response.getheader("Content-Type", "").lower(), url
        finally:
            connection.close()
            sock.close()
    raise ClipError("Website exceeded the redirect limit")


class _HTMLText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.hidden: list[str] = []
        self.in_title = False
        self.title: list[str] = []
        self.text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "noscript", "template", "svg"}:
            self.hidden.append(tag)
        if tag == "title":
            self.in_title = True
        if tag in {"p", "div", "article", "section", "br", "li", "h1", "h2", "h3", "tr"}:
            self.text.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if self.hidden and self.hidden[-1] == tag:
            self.hidden.pop()
        if tag == "title":
            self.in_title = False
        if tag in {"p", "div", "article", "section", "li", "h1", "h2", "h3", "tr"}:
            self.text.append("\n")

    def handle_data(self, data: str) -> None:
        if self.hidden:
            return
        if self.in_title:
            self.title.append(data)
        else:
            self.text.append(data)


def extract(raw: bytes, content_type: str) -> tuple[str, str, str]:
    if len(raw) > MAX_BYTES:
        raise ClipError("Source exceeds the 8 MiB import limit")
    if raw.startswith(b"%PDF-"):
        worker = Path(__file__).with_name("pdf_extract_worker.py")
        try:
            result = subprocess.run(
                [sys.executable, "-I", str(worker)],
                input=raw,
                capture_output=True,
                timeout=25,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise ClipError("PDF extraction exceeded the 25 second limit") from exc
        if result.returncode:
            raise ClipError(
                "PDF extraction failed: encrypted, malformed or over the extraction limits"
            )
        data = json.loads(result.stdout)
        text, title, extension = data["text"], data["title"], "pdf"
    elif content_type.startswith(("text/html", "application/xhtml+xml")):
        match = re.search(r"charset=([\w-]+)", content_type)
        try:
            decoded = raw.decode(match[1] if match else "utf-8", errors="replace")
        except LookupError:
            decoded = raw.decode("utf-8", errors="replace")
        parser = _HTMLText()
        parser.feed(decoded)
        text = "\n".join(line.strip() for line in "".join(parser.text).splitlines() if line.strip())
        title, extension = " ".join("".join(parser.title).split())[:200], "html"
    elif content_type.startswith("text/plain"):
        text, title, extension = raw.decode("utf-8", errors="replace"), "", "txt"
    else:
        raise ClipError("Supported imports are HTML, plain text and text-based PDF")
    if not text.strip():
        raise ClipError(
            "No readable text found. Scanned PDFs need OCR; JavaScript-only pages need pasted text."
        )
    if len(text) > MAX_TEXT:
        raise ClipError(
            "Extracted text exceeds 400,000 characters; split the source before importing"
        )
    return text, title, extension


def preserve_original(vault: Path, raw: bytes, extension: str) -> tuple[str, str]:
    digest = hashlib.sha256(raw).hexdigest()
    # Kept outside .loom caches so ordinary vault export includes originals.
    directory = vault / "attachments"
    directory.mkdir(exist_ok=True)
    if directory.is_symlink() or directory.resolve().parent != vault.resolve():
        raise ClipError("Unsafe attachment directory")
    filename = f"{digest}.{extension}"
    path = directory / filename
    if path.is_symlink():
        raise ClipError("Unsafe attachment path")
    try:
        with path.open("xb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
    except FileExistsError:
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ClipError("Existing original attachment failed its integrity check") from None
    return digest, filename
