"""Rules engine: loads, caches, and enforces vault rules at runtime."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from rules.parser import parse_policy, parse_schema, parse_workflow

if TYPE_CHECKING:
    from pathlib import Path

    from rules.models import PolicyRule, SchemaRule, WorkflowRule

logger = logging.getLogger(__name__)


class RulesEngine:
    """Loads rule files from a vault and enforces them at runtime.

    The engine is initialised with a vault root path and must be explicitly
    loaded via :meth:`load` before it can validate notes or check policies.

    Attributes:
        vault_root: Root path of the vault.
        schemas: Parsed schema rules keyed by note type.
        policies: All parsed policy rules.
        workflows: All parsed workflow rules.
    """

    def __init__(self, vault_root: Path) -> None:
        self.vault_root = vault_root
        self.schemas: dict[str, SchemaRule] = {}
        self.policies: list[PolicyRule] = []
        self.workflows: list[WorkflowRule] = []

    # -- Loading --------------------------------------------------------------

    def load(self) -> None:
        """Parse all rule files from the vault's ``rules/`` directory.

        Populates :attr:`schemas`, :attr:`policies`, and :attr:`workflows`
        from the corresponding subdirectories. Logs warnings for files that
        fail to parse rather than raising.
        """
        rules_dir = self.vault_root / "rules"
        if not rules_dir.is_dir():
            logger.warning("No rules/ directory found at %s", self.vault_root)
            return

        self._load_schemas(rules_dir / "schemas")
        self._load_policies(rules_dir / "policies")
        self._load_workflows(rules_dir / "workflows")

    # -- Schema validation ----------------------------------------------------

    def validate_note(self, frontmatter: dict, note_type: str) -> list[str]:
        """Check a note's frontmatter against its schema.

        Args:
            frontmatter: The parsed YAML frontmatter dict from the note.
            note_type: The note type (e.g. ``"project"``, ``"daily"``).

        Returns:
            A list of human-readable violation strings. An empty list means
            the note is valid against the schema.
        """
        schema = self.schemas.get(note_type)
        if schema is None:
            return [f"No schema found for note type '{note_type}'"]

        violations: list[str] = []
        for field in schema.required_fields:
            if field not in frontmatter:
                violations.append(f"Missing required field: {field}")
            elif frontmatter[field] is None:
                violations.append(f"Field '{field}' is present but null")

        # Type-level checks for fields that have a declared type.
        for field, expected_type in schema.field_types.items():
            if field not in frontmatter:
                continue
            value = frontmatter[field]
            if expected_type == "list" and not isinstance(value, list):
                violations.append(
                    f"Field '{field}' should be a list, got {type(value).__name__}"
                )

        return violations

    # -- Policy checking ------------------------------------------------------

    def check_policy(self, agent_name: str, action: str, context: dict) -> bool:
        """Check whether an agent action is permitted by loaded policies.

        This performs a simple keyword match: if any policy's conditions
        mention the given *action* keyword and the policy is scoped to the
        agent (or to all agents), the action is considered governed and
        therefore allowed. If no policies reference the action at all the
        action is allowed by default (open-world assumption).

        Args:
            agent_name: The agent requesting the action (e.g. ``"spider"``).
            action: A short action keyword (e.g. ``"link"``, ``"archive"``).
            context: Additional context dict (reserved for future use).

        Returns:
            ``True`` if the action is allowed, ``False`` if explicitly denied.
        """
        matching_policies = [
            p for p in self.policies
            if p.agent is None or p.agent.lower() == agent_name.lower()
        ]

        if not matching_policies:
            return True

        # Check if any policy condition references this action.
        action_lower = action.lower()
        for policy in matching_policies:
            for condition in policy.conditions:
                if action_lower in condition.lower() and policy.action == "deny":
                    return False
        return True

    # -- Workflow lookup -------------------------------------------------------

    def get_workflow(self, trigger: str) -> WorkflowRule | None:
        """Find a workflow whose trigger matches the given string.

        Performs a case-insensitive substring match against the workflow's
        trigger text.

        Args:
            trigger: The event description to match (e.g.
                ``"New file appears in threads/captures/"``).

        Returns:
            The first matching ``WorkflowRule``, or ``None``.
        """
        trigger_lower = trigger.lower()
        for workflow in self.workflows:
            if not workflow.trigger:
                continue
            if trigger_lower in workflow.trigger.lower():
                return workflow
        return None

    # -- Private loaders ------------------------------------------------------

    def _load_schemas(self, schemas_dir: Path) -> None:
        """Load all schema ``.md`` files from *schemas_dir*."""
        if not schemas_dir.is_dir():
            return
        for path in sorted(schemas_dir.glob("*.md")):
            try:
                schema = parse_schema(path)
                self.schemas[schema.note_type] = schema
            except Exception:
                logger.exception("Failed to parse schema: %s", path)

    def _load_policies(self, policies_dir: Path) -> None:
        """Load all policy ``.md`` files from *policies_dir*."""
        if not policies_dir.is_dir():
            return
        for path in sorted(policies_dir.glob("*.md")):
            try:
                policy = parse_policy(path)
                self.policies.append(policy)
            except Exception:
                logger.exception("Failed to parse policy: %s", path)

    def _load_workflows(self, workflows_dir: Path) -> None:
        """Load all workflow ``.md`` files from *workflows_dir*."""
        if not workflows_dir.is_dir():
            return
        for path in sorted(workflows_dir.glob("*.md")):
            try:
                workflow = parse_workflow(path)
                self.workflows.append(workflow)
            except Exception:
                logger.exception("Failed to parse workflow: %s", path)
