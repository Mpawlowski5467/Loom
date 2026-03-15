"""Sentinel agent: the reviewer. Validates agent actions against prime.md
rules, note schemas, and vault policies.

Other agents call Sentinel after completing their actions. Sentinel's verdict
is logged in the changelog.
"""

from __future__ import annotations

import contextlib
import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from agents.base import BaseAgent
from core.notes import parse_note

if TYPE_CHECKING:
    from pathlib import Path

    from agents.chain import ReadChainResult
    from core.providers import BaseProvider

logger = logging.getLogger(__name__)

REQUIRED_META_FIELDS = ["id", "title", "type", "tags", "created", "modified", "author", "status"]

_VALIDATE_SYSTEM = """\
You are the Sentinel agent in a knowledge management system. Your job is to
validate whether an agent's action complies with vault rules.

Given:
- The vault constitution (prime.md)
- The agent action details
- The resulting note content

Check for:
1. Does the action comply with prime.md rules?
2. Does the note match its type schema?
3. Are there any policy violations?
4. Was the read chain completed?

Respond with:
status: passed|failed|warning
reasons:
- <reason 1>
- <reason 2>

If everything is fine, respond:
status: passed
reasons:
- All checks passed
"""


@dataclass
class ValidationResult:
    """Result of a Sentinel validation check."""

    status: str = "passed"  # passed, failed, warning
    reasons: list[str] = field(default_factory=list)
    agent_name: str = ""
    action: str = ""
    target: str = ""

    def to_dict(self) -> dict:
        return {
            "status": self.status,
            "reasons": self.reasons,
            "agent_name": self.agent_name,
            "action": self.action,
            "target": self.target,
        }


class Sentinel(BaseAgent):
    """Sentinel validates agent actions against vault rules and schemas."""

    @property
    def name(self) -> str:
        return "sentinel"

    @property
    def role(self) -> str:
        return "Reviewer: validates agent actions against rules and schemas"

    async def validate_action(
        self,
        agent_name: str,
        action: str,
        target: Path,
        chain_result: ReadChainResult,
    ) -> ValidationResult:
        """Validate an agent's completed action.

        Checks: chain completion, schema compliance, policy adherence.
        """
        validation = ValidationResult(agent_name=agent_name, action=action, target=str(target))

        # 1. Check chain completion
        if not chain_result.success:
            failed = [s.name for s in chain_result.failed_required]
            validation.status = "failed"
            validation.reasons.append(f"Read chain incomplete: missing {', '.join(failed)}")

        # 2. Check target note (if it exists and is a note file)
        if target.is_file() and target.suffix == ".md":
            note_issues = self._check_note_compliance(target, chain_result)
            if note_issues:
                for issue in note_issues:
                    validation.reasons.append(issue)
                if validation.status == "passed":
                    validation.status = "warning"

        # 3. LLM-assisted validation if provider available
        if self._chat_provider is not None and chain_result.prime_text:
            llm_result = await self._llm_validate(agent_name, action, target, chain_result)
            if llm_result.status == "failed":
                validation.status = "failed"
            elif llm_result.status == "warning" and validation.status == "passed":
                validation.status = "warning"
            validation.reasons.extend(llm_result.reasons)

        if not validation.reasons:
            validation.reasons.append("All checks passed")

        # Log the validation result
        from agents.changelog import log_action

        log_action(
            self._vault_root,
            self.name,
            "validated",
            str(target),
            details=f"[{validation.status}] {agent_name}/{action}: {'; '.join(validation.reasons)}",
            chain_status="pass",
        )

        return validation

    def _check_note_compliance(self, note_path: Path, chain_result: ReadChainResult) -> list[str]:
        """Check a note against required fields and its type schema."""
        issues: list[str] = []

        try:
            note = parse_note(note_path)
        except Exception as exc:  # noqa: BLE001
            return [f"Failed to parse note: {exc}"]

        meta_dict = note.model_dump()

        # Required frontmatter fields
        for field_name in REQUIRED_META_FIELDS:
            val = meta_dict.get(field_name)
            if not val or (isinstance(val, str) and not val.strip()):
                issues.append(f"Missing required field: {field_name}")

        # History tracking (prime.md rule 5)
        if not note.history:
            issues.append("No history entries — rule 5 requires logging every action")

        # Schema section check
        schema_issues = self._check_schema_sections(note)
        issues.extend(schema_issues)

        return issues

    def _check_schema_sections(self, note) -> list[str]:
        """Check if note has expected sections for its type."""
        expected_sections: dict[str, list[str]] = {
            "project": ["Overview", "Goals", "Status", "Related"],
            "topic": ["Summary", "Details", "References"],
            "person": ["Context", "Notes", "Related"],
            "daily": ["Log", "Tasks", "Links"],
            "capture": ["Content", "Context"],
        }

        sections = expected_sections.get(note.type, [])
        if not sections:
            return []

        body_lower = note.body.lower()
        missing = [s for s in sections if f"## {s.lower()}" not in body_lower]

        if missing:
            return [f"Missing expected section(s): {', '.join(missing)}"]
        return []

    async def _llm_validate(
        self,
        agent_name: str,
        action: str,
        target: Path,
        chain_result: ReadChainResult,
    ) -> ValidationResult:
        """Use LLM for deeper policy validation."""
        result = ValidationResult(agent_name=agent_name, action=action, target=str(target))

        target_content = ""
        if target.is_file() and target.suffix == ".md":
            with contextlib.suppress(Exception):
                target_content = target.read_text(encoding="utf-8")[:3000]

        user_msg = (
            f"Agent: {agent_name}\nAction: {action}\nTarget: {target}\n\n"
            f"Prime.md:\n{chain_result.prime_text[:2000]}\n\n"
            f"Note content:\n{target_content}\n\n"
            "Validate this action."
        )

        try:
            resp = await self._chat_provider.chat(
                messages=[{"role": "user", "content": user_msg}],
                system=_VALIDATE_SYSTEM,
            )
            return self._parse_validation_response(resp, agent_name, action, str(target))
        except Exception:  # noqa: BLE001
            logger.warning("LLM validation failed", exc_info=True)
            return result

    @staticmethod
    def _parse_validation_response(
        text: str, agent_name: str, action: str, target: str
    ) -> ValidationResult:
        """Parse LLM validation response."""
        result = ValidationResult(agent_name=agent_name, action=action, target=target)

        for line in text.strip().splitlines():
            line = line.strip()
            if line.lower().startswith("status:"):
                status = line.split(":", 1)[1].strip().lower()
                if status in ("passed", "failed", "warning"):
                    result.status = status
            elif line.startswith("- "):
                reason = line[2:].strip()
                if reason:
                    result.reasons.append(reason)

        if not result.reasons:
            result.reasons.append("Validation complete")
        return result


_sentinel: Sentinel | None = None


def get_sentinel() -> Sentinel | None:
    return _sentinel


def init_sentinel(vault_root: Path, chat_provider: BaseProvider | None = None) -> Sentinel:
    global _sentinel
    _sentinel = Sentinel(vault_root, chat_provider)
    return _sentinel
