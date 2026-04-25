"""Dataclasses, prompts, and thresholds for the Spider agent.

Extracted from spider.py to keep the agent module focused on orchestration.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# -- Thresholds (configurable via linking policy) ----------------------------

AUTO_LINK_THRESHOLD = 0.75
SUGGEST_THRESHOLD = 0.50
MAX_CANDIDATES = 10

# -- LLM prompt for fallback connection finding ------------------------------

FIND_CONNECTIONS_SYSTEM = """\
You are the Spider agent in a knowledge management system. Your job is to
identify meaningful connections between notes.

Given a source note and a list of existing vault notes (title + tags), return
the titles of notes that have a meaningful conceptual relationship with the
source. Only suggest connections that add real value — not just keyword overlap.

Respond with one title per line. No bullet points, no explanations. Just titles.
If there are no meaningful connections, respond with "NONE".
"""


@dataclass
class LinkCandidate:
    """A potential link discovered by Spider."""

    note_id: str
    title: str
    score: float
    decision: str  # "auto-linked", "suggested", "skipped"
    reason: str = ""


@dataclass
class ScanReport:
    """Full result of a Spider scan on a single note."""

    source_id: str
    source_title: str
    candidates: list[LinkCandidate] = field(default_factory=list)
    auto_linked: list[str] = field(default_factory=list)
    suggested: list[str] = field(default_factory=list)
    skipped: int = 0
    error: str = ""

    def to_dict(self) -> dict[str, Any]:
        """Serialize for API responses."""
        return {
            "source_id": self.source_id,
            "source_title": self.source_title,
            "auto_linked": self.auto_linked,
            "suggested": self.suggested,
            "skipped": self.skipped,
            "candidates": [
                {
                    "note_id": c.note_id,
                    "title": c.title,
                    "score": round(c.score, 4),
                    "decision": c.decision,
                    "reason": c.reason,
                }
                for c in self.candidates
            ],
        }


@dataclass
class VaultScanReport:
    """Full result of a Spider scan across the whole vault."""

    reports: list[ScanReport] = field(default_factory=list)
    total_auto_linked: int = 0
    total_suggested: int = 0
    total_skipped: int = 0

    def to_dict(self) -> dict[str, Any]:
        """Serialize for API responses."""
        return {
            "notes_scanned": len(self.reports),
            "total_auto_linked": self.total_auto_linked,
            "total_suggested": self.total_suggested,
            "total_skipped": self.total_skipped,
            "reports": [r.to_dict() for r in self.reports if r.auto_linked or r.suggested],
        }
