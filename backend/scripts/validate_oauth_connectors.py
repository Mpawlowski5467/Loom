#!/usr/bin/env python3
"""Validate real Google, Microsoft, and GitHub connections against a running Loom.

Connection tests are read-only and refresh expired tokens through the same
code path used by the pollers. ``--sync-twice`` is opt-in because it ingests
captures; the second pass reports duplicate suppression evidence.
"""

from __future__ import annotations

import argparse
import json
import os
from typing import Any, TypedDict
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def _request(base: str, path: str, *, token: str, method: str = "GET") -> dict[str, Any]:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(f"{base.rstrip('/')}{path}", headers=headers, method=method)
    try:
        with urlopen(request, timeout=30) as response:
            payload = json.load(response)
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{path} returned HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Could not reach Loom at {base}: {exc.reason}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError(f"{path} returned a non-object JSON payload")
    return payload


def _connected(name: str, payload: dict[str, Any]) -> bool:
    if name == "github":
        github = payload.get("github")
        return isinstance(github, dict) and github.get("token_set") is True
    connection = payload.get("connection")
    return isinstance(connection, dict) and connection.get("connected") is True


def _test_ok(name: str, payload: dict[str, Any]) -> bool:
    if name == "google":
        return all(
            isinstance(payload.get(service), dict) and payload[service].get("ok") is True
            for service in ("calendar", "gmail")
        )
    if name == "github":
        repos = payload.get("repos")
        return (
            isinstance(repos, list)
            and bool(repos)
            and all(isinstance(repo, dict) and repo.get("ok") is True for repo in repos)
        )
    return payload.get("ok") is True


def _account(name: str, payload: dict[str, Any]) -> str:
    section = payload.get("github") if name == "github" else payload.get("connection")
    if not isinstance(section, dict):
        return ""
    return str(section.get("account") or "")


class ConnectorRoutes(TypedDict):
    status: str
    test: str
    sync: list[str]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-base", default="http://localhost:8000")
    parser.add_argument(
        "--api-token",
        default=os.environ.get("LOOM_API_TOKEN", ""),
        help="Loom API token (defaults to LOOM_API_TOKEN)",
    )
    parser.add_argument(
        "--sync-twice",
        action="store_true",
        help="Run connector syncs twice to collect idempotency evidence",
    )
    args = parser.parse_args()

    connectors: dict[str, ConnectorRoutes] = {
        "google": {
            "status": "/api/automations/google",
            "test": "/api/automations/google/test",
            "sync": [
                "/api/automations/google/sync/calendar",
                "/api/automations/google/sync/gmail",
            ],
        },
        "outlook": {
            "status": "/api/automations/calendar/outlook",
            "test": "/api/automations/calendar/outlook/test",
            "sync": ["/api/automations/calendar/outlook/sync"],
        },
        "github": {
            "status": "/api/automations/github",
            "test": "/api/automations/github/test",
            "sync": ["/api/automations/github/sync"],
        },
    }
    report: dict[str, Any] = {"api_base": args.api_base, "connectors": {}}
    failures: list[str] = []

    for name, routes in connectors.items():
        try:
            status = _request(args.api_base, routes["status"], token=args.api_token)
            connected = _connected(name, status)
            probe = (
                _request(args.api_base, routes["test"], token=args.api_token, method="POST")
                if connected
                else {"skipped": "not connected"}
            )
            entry: dict[str, Any] = {
                "connected": connected,
                "account": _account(name, status),
                "probe": probe,
            }
            if not connected or not _test_ok(name, probe):
                failures.append(name)

            if args.sync_twice and connected:
                entry["syncs"] = {}
                for route in routes["sync"]:
                    entry["syncs"][route] = [
                        _request(args.api_base, route, token=args.api_token, method="POST"),
                        _request(args.api_base, route, token=args.api_token, method="POST"),
                    ]
            report["connectors"][name] = entry
        except RuntimeError as exc:
            failures.append(name)
            report["connectors"][name] = {"error": str(exc)}

    report["passed"] = not failures
    report["failed_connectors"] = sorted(set(failures))
    print(json.dumps(report, indent=2))
    raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    main()
