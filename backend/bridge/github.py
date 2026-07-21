"""GitHub Bridge adapter: poll repositories for activity → capture items.

Read-only. Talks to the GitHub REST API with an optional personal access
token (read-only scopes suffice); without a token only public repositories
work, at a much lower rate limit. Each activity item is normalized into a
:class:`GitHubItem` with a stable ``external_id`` so capture ingress can
deduplicate producer retries — the same commit/issue/PR never files twice.

Bounds (v1, deliberate): each feed fetches one page of 50 items per poll —
a repo busier than 50 commits/issues per interval sheds the overflow (use a
shorter interval or webhooks when they land). The poller and a manual sync
may overlap; ingress idempotency makes that safe, just occasionally
redundant.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Literal

import httpx

logger = logging.getLogger(__name__)

_API_BASE = "https://api.github.com"
_API_VERSION = "2022-11-28"
_PER_PAGE = 50
_MAX_BODY_CHARS = 2000
_MAX_TITLE_CHARS = 300
_TIMEOUT = httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=10.0)

GitHubKind = Literal["commit", "issue", "pr"]


class GitHubError(RuntimeError):
    """Raised for GitHub API failures (network, auth, rate limit, 404)."""


@dataclass
class GitHubItem:
    """One repository activity item, normalized for capture ingress."""

    kind: GitHubKind
    repo: str  # "owner/name"
    external_id: str
    title: str
    body: str
    url: str
    author: str
    occurred_at: str  # ISO timestamp from GitHub; drives cursor advancement
    state: str = ""
    labels: list[str] = field(default_factory=list)

    def to_capture_markdown(self) -> str:
        """Render the item as the capture's markdown body."""
        lines: list[str] = []
        if self.kind == "commit":
            sha8 = self.external_id.rsplit(":", 1)[-1][:8]
            lines.append(f"## Commit `{sha8}` on {self.repo}")
        else:
            number = self.external_id.rsplit(":", 1)[-1]
            heading = "Pull request" if self.kind == "pr" else "Issue"
            state = f" — {self.state}" if self.state else ""
            lines.append(f"## {heading} {self.repo}#{number}{state}")
        lines.append("")
        if self.body:
            lines.append(self.body)
            lines.append("")
        meta = [f"- Author: {self.author or 'unknown'}"]
        if self.labels:
            meta.append(f"- Labels: {', '.join(self.labels)}")
        meta.append(f"- Date: {self.occurred_at}")
        meta.append(f"- URL: {self.url}")
        lines.extend(meta)
        return "\n".join(lines) + "\n"

    def provenance(self) -> dict[str, Any]:
        """Structured metadata stored alongside the capture."""
        return {
            "github": self.repo,
            "kind": self.kind,
            "url": self.url,
            "author": self.author,
            "state": self.state,
            "labels": list(self.labels),
            "occurred_at": self.occurred_at,
        }


def _clip(text: str, limit: int) -> str:
    text = (text or "").strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


class GitHubClient:
    """Minimal async GitHub REST client (httpx, optional Bearer token)."""

    def __init__(self, token: str | None = None, client: httpx.AsyncClient | None = None) -> None:
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": _API_VERSION,
            # GitHub rejects requests without a User-Agent.
            "User-Agent": "loom-github-bridge",
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(
            base_url=_API_BASE, headers=headers, timeout=_TIMEOUT
        )

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def _get_json(self, path: str, params: dict[str, Any] | None = None) -> Any:
        try:
            resp = await self._client.get(path, params=params or {})
        except httpx.HTTPError as exc:
            raise GitHubError(f"GitHub request failed: {exc}") from exc
        if resp.status_code == 401:
            raise GitHubError("GitHub token was rejected (401) — check it in Connections")
        if resp.status_code == 404:
            raise GitHubError(f"Not found or not accessible: {path}")
        if resp.status_code == 403:
            remaining = resp.headers.get("x-ratelimit-remaining")
            if remaining == "0" or "rate limit" in resp.text.lower():
                raise GitHubError("GitHub rate limit exceeded — add a token or retry later")
            raise GitHubError(f"GitHub forbids this request (403): {resp.text[:200]}")
        if resp.status_code >= 400:
            raise GitHubError(f"GitHub API error {resp.status_code}: {resp.text[:200]}")
        return resp.json()

    async def validate_repo(self, repo: str) -> dict[str, Any]:
        """Fetch repo metadata — used by the connection-test endpoint."""
        data = await self._get_json(f"/repos/{repo}")
        return {
            "repo": data.get("full_name", repo),
            "private": bool(data.get("private")),
            "description": data.get("description") or "",
            "default_branch": data.get("default_branch") or "",
            "pushed_at": data.get("pushed_at") or "",
        }

    async def fetch_commits(self, repo: str, since_iso: str) -> list[GitHubItem]:
        """Commits on the default branch committed at/after ``since_iso``."""
        data = await self._get_json(
            f"/repos/{repo}/commits", {"since": since_iso, "per_page": _PER_PAGE}
        )
        items: list[GitHubItem] = []
        for entry in data or []:
            sha = str(entry.get("sha") or "")
            if not sha:
                continue
            commit = entry.get("commit") or {}
            message = str(commit.get("message") or "")
            title, _, rest = message.partition("\n")
            author = (entry.get("author") or {}).get("login") or (
                (commit.get("author") or {}).get("name") or ""
            )
            occurred = str((commit.get("committer") or {}).get("date") or "")
            items.append(
                GitHubItem(
                    kind="commit",
                    repo=repo,
                    external_id=f"github:{repo}:commit:{sha}",
                    title=_clip(title, _MAX_TITLE_CHARS) or f"Commit {sha[:8]}",
                    body=_clip(rest, _MAX_BODY_CHARS),
                    url=str(entry.get("html_url") or ""),
                    author=author,
                    occurred_at=occurred,
                )
            )
        return items

    async def fetch_issues_and_prs(self, repo: str, since_iso: str) -> list[GitHubItem]:
        """Issues and PRs updated at/after ``since_iso`` (the issues feed
        includes PRs; they are split on the ``pull_request`` key)."""
        data = await self._get_json(
            f"/repos/{repo}/issues",
            {
                "since": since_iso,
                "state": "all",
                "sort": "updated",
                "direction": "asc",
                "per_page": _PER_PAGE,
            },
        )
        items: list[GitHubItem] = []
        for entry in data or []:
            number = entry.get("number")
            if number is None:
                continue
            is_pr = "pull_request" in entry
            kind: GitHubKind = "pr" if is_pr else "issue"
            labels = [
                str(label.get("name"))
                for label in entry.get("labels") or []
                if isinstance(label, dict) and label.get("name")
            ]
            items.append(
                GitHubItem(
                    kind=kind,
                    repo=repo,
                    external_id=f"github:{repo}:{kind}:{number}",
                    title=_clip(str(entry.get("title") or ""), _MAX_TITLE_CHARS) or f"#{number}",
                    body=_clip(str(entry.get("body") or ""), _MAX_BODY_CHARS),
                    url=str(entry.get("html_url") or ""),
                    author=str((entry.get("user") or {}).get("login") or ""),
                    occurred_at=str(entry.get("updated_at") or ""),
                    state=str(entry.get("state") or ""),
                    labels=labels,
                )
            )
        return items


async def fetch_repo_activity(
    client: GitHubClient,
    repo: str,
    *,
    commits_since: str | None,
    issues_since: str | None,
    include_commits: bool,
    include_issues: bool,
    include_pull_requests: bool,
) -> AsyncIterator[GitHubItem]:
    """Yield activity items for one repo, honoring the include flags.

    Issues and PRs share one feed, so a repo with both disabled makes no
    issue-feed call at all; a repo with only one enabled filters the other
    kind out after the (shared) fetch.
    """
    if include_commits and commits_since is not None:
        for item in await client.fetch_commits(repo, commits_since):
            yield item
    if (include_issues or include_pull_requests) and issues_since is not None:
        for item in await client.fetch_issues_and_prs(repo, issues_since):
            if (item.kind == "issue" and include_issues) or (
                item.kind == "pr" and include_pull_requests
            ):
                yield item
