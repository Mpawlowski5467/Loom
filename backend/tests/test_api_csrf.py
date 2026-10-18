"""Tests for the cross-site write guard in :mod:`api.csrf`.

Probe requests go to an unknown ``/api`` path: a 404 means the request passed
the guard and reached routing, a 403 means the guard refused it first.
"""

import pytest
from starlette.testclient import TestClient

from api.main import app
from core.config import settings
from tests.test_api_vaults import _make_export_tarball

PROBE_PATH = "/api/__csrf_probe__"
DEV_ORIGIN = "http://localhost:5173"
EVIL_ORIGIN = "https://evil.example"


@pytest.fixture()
def probe(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(settings, "api_token", "")
    monkeypatch.setattr(settings, "cors_origins", [DEV_ORIGIN])
    return TestClient(app)


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_cross_site_write_is_refused(probe: TestClient, method: str) -> None:
    resp = probe.request(method, PROBE_PATH, headers={"Origin": EVIL_ORIGIN})
    assert resp.status_code == 403
    assert resp.json()["type"] == "Forbidden"


@pytest.mark.parametrize(
    "headers",
    [
        {},  # curl, scripts: no Origin at all
        {"Origin": DEV_ORIGIN},  # configured LOOM_CORS_ORIGINS entry
        {"Origin": "http://testserver"},  # same origin as the API (bundled SPA)
        {"Origin": "http://TESTSERVER"},  # host comparison is case-insensitive
        {"Sec-Fetch-Site": "same-origin"},
    ],
    ids=["no-origin", "cors-origin", "same-origin", "same-origin-case", "fetch-same"],
)
def test_trusted_writes_pass(probe: TestClient, headers: dict[str, str]) -> None:
    assert probe.post(PROBE_PATH, headers=headers).status_code == 404


@pytest.mark.parametrize(
    "headers",
    [
        {"Origin": "null"},  # sandboxed iframe / file://
        {"Origin": "http://testserver.evil.example"},
        {"Sec-Fetch-Site": "cross-site"},  # browser-marked, Origin stripped
    ],
    ids=["null-origin", "lookalike-host", "fetch-cross-site"],
)
def test_other_untrusted_writes_are_refused(probe: TestClient, headers: dict[str, str]) -> None:
    assert probe.post(PROBE_PATH, headers=headers).status_code == 403


def test_reads_are_left_to_cors(probe: TestClient) -> None:
    assert probe.get(PROBE_PATH, headers={"Origin": EVIL_ORIGIN}).status_code == 404


def test_wildcard_cors_config_allows_any_origin(
    probe: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "cors_origins", ["*"])
    assert probe.post(PROBE_PATH, headers={"Origin": EVIL_ORIGIN}).status_code == 404


def test_cross_site_page_cannot_archive_or_overwrite_a_vault(
    client: TestClient, vault_manager, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The original attack: bodyless or text/plain POSTs need no preflight."""
    monkeypatch.setattr(settings, "api_token", "")
    client.post("/api/vaults", json={"name": "first"})
    root = vault_manager.vault_path("first")
    marker = root / "threads" / "marker.md"
    marker.write_text("unchanged", encoding="utf-8")
    attacker = {"Origin": EVIL_ORIGIN}

    archive = client.post("/api/vaults/first/archive", headers=attacker)
    overwrite = client.post(
        "/api/vaults/first/import",
        params={"overwrite": "true"},
        content=_make_export_tarball("first"),
        headers={**attacker, "Content-Type": "text/plain"},
    )

    assert archive.status_code == 403
    assert overwrite.status_code == 403
    assert marker.read_text(encoding="utf-8") == "unchanged"
    assert not list(vault_manager._settings.vaults_dir.glob("first.archived-*"))
