"""Tests for the live OAuth release-validation CLI's connector matrix."""

from __future__ import annotations

import json
import sys
from typing import Any

import pytest

from scripts import validate_oauth_connectors as validation


def test_connector_shape_helpers_cover_github() -> None:
    status = {"github": {"token_set": True, "account": "octocat"}}
    assert validation._connected("github", status) is True
    assert validation._account("github", status) == "octocat"
    assert validation._test_ok("github", {"repos": [{"repo": "o/r", "ok": True}]})
    assert not validation._test_ok(
        "github",
        {"repos": [{"repo": "o/r", "ok": False}]},
    )
    assert not validation._test_ok("github", {"repos": []})


def test_main_reports_all_connected_connectors(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    responses: dict[str, dict[str, Any]] = {
        "/api/automations/google": {
            "connection": {"connected": True, "account": "google@example.com"}
        },
        "/api/automations/google/test": {
            "calendar": {"ok": True},
            "gmail": {"ok": True},
        },
        "/api/automations/calendar/outlook": {
            "connection": {"connected": True, "account": "microsoft@example.com"}
        },
        "/api/automations/calendar/outlook/test": {"ok": True},
        "/api/automations/github": {"github": {"token_set": True, "account": "octocat"}},
        "/api/automations/github/test": {"repos": [{"repo": "octocat/hello-world", "ok": True}]},
    }

    def fake_request(
        base: str,
        path: str,
        *,
        token: str,
        method: str = "GET",
    ) -> dict[str, Any]:
        assert base == "http://localhost:8000"
        assert token == ""
        assert method in {"GET", "POST"}
        return responses[path]

    monkeypatch.setattr(validation, "_request", fake_request)
    monkeypatch.setattr(sys, "argv", ["validate_oauth_connectors.py"])

    with pytest.raises(SystemExit, match="0"):
        validation.main()

    report = json.loads(capsys.readouterr().out)
    assert report["passed"] is True
    assert report["failed_connectors"] == []
    assert report["connectors"]["github"]["account"] == "octocat"


def test_main_fails_when_a_github_repo_probe_fails(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    def fake_request(
        base: str,
        path: str,
        *,
        token: str,
        method: str = "GET",
    ) -> dict[str, Any]:
        del base, token, method
        if path == "/api/automations/github":
            return {"github": {"token_set": True, "account": "octocat"}}
        if path == "/api/automations/github/test":
            return {"repos": [{"repo": "octocat/private", "ok": False}]}
        return {"connection": {"connected": False}}

    monkeypatch.setattr(validation, "_request", fake_request)
    monkeypatch.setattr(sys, "argv", ["validate_oauth_connectors.py"])

    with pytest.raises(SystemExit, match="1"):
        validation.main()

    report = json.loads(capsys.readouterr().out)
    assert report["passed"] is False
    assert report["failed_connectors"] == ["github", "google", "outlook"]
