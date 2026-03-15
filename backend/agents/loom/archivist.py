"""Archivist agent: the organizer. Audits vault notes for quality issues
like missing frontmatter, broken wikilinks, and stale content.

The Archivist does NOT auto-fix. It flags issues for user review.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from agents.base import BaseAgent
from core.notes import parse_note, parse_note_meta

if TYPE_CHECKING:
    from pathlib import Path

    from agents.chain import ReadChainResult
    from core.providers import BaseProvider

logger = logging.getLogger(__name__)

REQUIRED_FIELDS = ["id", "title", "type", "tags", "created", "modified", "status"]
DEFAULT_STALE_DAYS = 30


@dataclass
class AuditIssue:
    """A single issue found during a note audit."""

    note_id: str
    note_title: str
    file_path: str
    issue_type: str  # missing_field, broken_link, stale, empty_body
    severity: str  # error, warning, info
    details: str
    suggested_action: str


@dataclass
class AuditResult:
    """Aggregate result of a vault or note audit."""

    total_notes: int = 0
    issues: list[AuditIssue] = field(default_factory=list)

    @property
    def error_count(self) -> int:
        return sum(1 for i in self.issues if i.severity == "error")

    @property
    def warning_count(self) -> int:
        return sum(1 for i in self.issues if i.severity == "warning")

    def to_dict(self) -> dict:
        return {
            "total_notes": self.total_notes,
            "issues": [
                {
                    "note_id": i.note_id,
                    "note_title": i.note_title,
                    "file_path": i.file_path,
                    "issue_type": i.issue_type,
                    "severity": i.severity,
                    "details": i.details,
                    "suggested_action": i.suggested_action,
                }
                for i in self.issues
            ],
            "error_count": self.error_count,
            "warning_count": self.warning_count,
        }


class Archivist(BaseAgent):
    """Archivist audits vault notes for quality and organization issues."""

    @property
    def name(self) -> str:
        return "archivist"

    @property
    def role(self) -> str:
        return "Organizer: audits notes for quality, broken links, and staleness"

    async def audit_note(self, note_path: Path) -> list[AuditIssue]:
        """Audit a single note for quality issues."""

        async def _action(chain: ReadChainResult) -> dict[str, Any]:
            issues = self._check_note(note_path)
            return {
                "action": "audited",
                "details": f"{len(issues)} issue(s) found in {note_path.name}",
                "issues": issues,
            }

        result = await self.execute_with_chain(note_path, _action)
        return result.get("issues", [])

    async def audit_vault(self) -> AuditResult:
        """Audit all notes in the vault. Returns aggregate AuditResult."""
        threads_dir = self._vault_root / "threads"

        async def _action(chain: ReadChainResult) -> dict[str, Any]:
            audit = AuditResult()
            if not threads_dir.exists():
                return {"action": "audited", "details": "No threads directory", "audit": audit}

            md_files = [
                p
                for p in threads_dir.rglob("*.md")
                if ".archive" not in p.parts and p.name != "_index.md"
            ]
            audit.total_notes = len(md_files)

            # Build title set for broken link detection
            title_set = self._build_title_set(threads_dir)

            for md_path in md_files:
                try:
                    issues = self._check_note(md_path, title_set=title_set)
                    audit.issues.extend(issues)
                except Exception:  # noqa: BLE001
                    logger.debug("Audit failed for %s", md_path, exc_info=True)

            return {
                "action": "audited",
                "details": (
                    f"Vault audit: {audit.total_notes} notes, "
                    f"{audit.error_count} errors, {audit.warning_count} warnings"
                ),
                "audit": audit,
            }

        result = await self.execute_with_chain(threads_dir, _action)
        return result.get("audit", AuditResult())

    def _check_note(
        self,
        note_path: Path,
        *,
        title_set: set[str] | None = None,
    ) -> list[AuditIssue]:
        """Run all checks on a single note."""
        issues: list[AuditIssue] = []
        try:
            note = parse_note(note_path)
        except Exception as exc:  # noqa: BLE001
            return [
                AuditIssue(
                    note_id="unknown",
                    note_title=note_path.stem,
                    file_path=str(note_path),
                    issue_type="parse_error",
                    severity="error",
                    details=f"Failed to parse: {exc}",
                    suggested_action="Fix YAML frontmatter syntax",
                )
            ]

        nid = note.id or "unknown"
        ntitle = note.title or note_path.stem

        # Check required frontmatter fields
        meta_dict = note.model_dump()
        for field_name in REQUIRED_FIELDS:
            val = meta_dict.get(field_name)
            if not val or (isinstance(val, str) and not val.strip()):
                issues.append(
                    AuditIssue(
                        note_id=nid,
                        note_title=ntitle,
                        file_path=str(note_path),
                        issue_type="missing_field",
                        severity="error",
                        details=f"Missing required field: {field_name}",
                        suggested_action=f"Add '{field_name}' to frontmatter",
                    )
                )

        # Check for empty tags (warning, not error)
        if not note.tags:
            issues.append(
                AuditIssue(
                    note_id=nid,
                    note_title=ntitle,
                    file_path=str(note_path),
                    issue_type="missing_field",
                    severity="warning",
                    details="Note has no tags",
                    suggested_action="Add relevant tags to improve discoverability",
                )
            )

        # Check for empty body
        if not note.body.strip():
            issues.append(
                AuditIssue(
                    note_id=nid,
                    note_title=ntitle,
                    file_path=str(note_path),
                    issue_type="empty_body",
                    severity="warning",
                    details="Note body is empty",
                    suggested_action="Add content or archive if no longer needed",
                )
            )

        # Check for broken wikilinks
        if title_set is None:
            title_set = self._build_title_set(self._vault_root / "threads")

        for wikilink in note.wikilinks:
            if wikilink.lower() not in title_set:
                issues.append(
                    AuditIssue(
                        note_id=nid,
                        note_title=ntitle,
                        file_path=str(note_path),
                        issue_type="broken_link",
                        severity="warning",
                        details=f"Broken wikilink: [[{wikilink}]]",
                        suggested_action=f"Create note '{wikilink}' or remove the link",
                    )
                )

        # Check for stale notes (not modified in STALE_DAYS)
        if note.modified:
            try:
                modified_dt = datetime.fromisoformat(note.modified)
                age_days = (datetime.now(UTC) - modified_dt).days
                if age_days > DEFAULT_STALE_DAYS:
                    issues.append(
                        AuditIssue(
                            note_id=nid,
                            note_title=ntitle,
                            file_path=str(note_path),
                            issue_type="stale",
                            severity="info",
                            details=f"Not modified in {age_days} days",
                            suggested_action="Review and update, or archive if obsolete",
                        )
                    )
            except (ValueError, TypeError):
                pass

        return issues

    @staticmethod
    def _build_title_set(threads_dir: Path) -> set[str]:
        """Build a set of lowercase note titles for link validation."""
        titles: set[str] = set()
        if not threads_dir.exists():
            return titles
        for md in threads_dir.rglob("*.md"):
            if ".archive" in md.parts:
                continue
            try:
                meta = parse_note_meta(md)
                if meta.title:
                    titles.add(meta.title.lower())
            except Exception:  # noqa: BLE001
                continue
        return titles


_archivist: Archivist | None = None


def get_archivist() -> Archivist | None:
    return _archivist


def init_archivist(vault_root: Path, chat_provider: BaseProvider | None = None) -> Archivist:
    global _archivist
    _archivist = Archivist(vault_root, chat_provider)
    return _archivist
