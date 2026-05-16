"""Read-Before-Write chain: mandatory context loading sequence for agents.

Every agent must complete this chain before creating or modifying any file.
Steps:
  1. vault.yaml        — parse into VaultConfig
  2. rules/prime.md    — vault constitution (REQUIRED)
  3. rules/<agent>.md  — role-specific rules (optional)
  4. agents/<agent>/memory.md — agent memory (optional)
  5. _index.md of target folder (optional)
  6. Related notes via wikilinks (up to 5)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

import yaml
from pydantic import ValidationError

from core.notes import parse_note

if TYPE_CHECKING:
    from pathlib import Path

    from core.note_index import NoteIndex

logger = logging.getLogger(__name__)

MAX_RELATED_NOTES = 5


@dataclass
class StepResult:
    """Outcome of a single step in the read chain."""

    name: str
    required: bool
    loaded: bool
    content: str = ""
    error: str = ""


@dataclass
class ReadChainResult:
    """Aggregate result of the full read chain."""

    success: bool
    steps: list[StepResult] = field(default_factory=list)
    vault_config: dict[str, Any] = field(default_factory=dict)
    prime_text: str = ""
    role_rules: str = ""
    memory: str = ""
    folder_index: str = ""
    related_notes: list[dict[str, Any]] = field(default_factory=list)

    @property
    def failed_required(self) -> list[StepResult]:
        """Return required steps that failed to load."""
        return [s for s in self.steps if s.required and not s.loaded]

    @property
    def context_text(self) -> str:
        """Concatenate all loaded context into a single string for prompts."""
        parts: list[str] = []
        if self.prime_text:
            parts.append(f"# Constitution\n\n{self.prime_text}")
        if self.role_rules:
            parts.append(f"# Role Rules\n\n{self.role_rules}")
        if self.memory:
            parts.append(f"# Agent Memory\n\n{self.memory}")
        if self.folder_index:
            parts.append(f"# Folder Index\n\n{self.folder_index}")
        for note in self.related_notes:
            parts.append(f"# Related: {note['title']}\n\n{note['body']}")
        return "\n\n---\n\n".join(parts)


class ReadChain:
    """Executes the mandatory read-before-write chain for an agent."""

    def __init__(self, vault_root: Path, note_index: NoteIndex | None = None) -> None:
        self._root = vault_root
        self._note_index = note_index

    def execute(self, agent_name: str, target_path: Path) -> ReadChainResult:
        """Run the full 6-step read chain.

        Args:
            agent_name: Name of the acting agent (e.g. ``"weaver"``).
            target_path: The file or folder the agent intends to act on.

        Returns:
            ReadChainResult with all loaded context and per-step status.
        """
        result = ReadChainResult(success=True)

        # Step 1: vault.yaml (required)
        result.steps.append(self._step_vault_config(result))

        # Step 2: prime.md (required)
        result.steps.append(self._step_prime(result))

        # Step 3: role rules (optional)
        result.steps.append(self._step_role_rules(agent_name, result))

        # Step 4: agent memory (optional)
        result.steps.append(self._step_memory(agent_name, result))

        # Step 5: folder _index.md (optional)
        result.steps.append(self._step_folder_index(target_path, result))

        # Step 6: related notes via wikilinks (optional)
        result.steps.append(self._step_related_notes(target_path, result))

        # Mark overall success based on required steps
        result.success = len(result.failed_required) == 0
        return result

    def _step_vault_config(self, result: ReadChainResult) -> StepResult:
        """Step 1: Read and parse vault.yaml."""
        path = self._root / "vault.yaml"
        step = StepResult(name="vault.yaml", required=True, loaded=False)
        try:
            text = path.read_text(encoding="utf-8")
            result.vault_config = yaml.safe_load(text) or {}
            step.content = text
            step.loaded = True
        except FileNotFoundError:
            step.error = f"vault.yaml not found at {path}"
            logger.warning("Read chain: %s", step.error)
        except (OSError, yaml.YAMLError, ValueError) as exc:
            step.error = f"Failed to parse vault.yaml: {exc}"
            logger.warning("Read chain: %s", step.error)
        return step

    def _step_prime(self, result: ReadChainResult) -> StepResult:
        """Step 2: Read rules/prime.md (vault constitution)."""
        path = self._root / "rules" / "prime.md"
        step = StepResult(name="prime.md", required=True, loaded=False)
        try:
            text = path.read_text(encoding="utf-8")
            result.prime_text = text
            step.content = text
            step.loaded = True
        except FileNotFoundError:
            step.error = f"prime.md not found at {path}"
            logger.warning("Read chain: %s", step.error)
        except (OSError, ValueError) as exc:
            step.error = f"Failed to read prime.md: {exc}"
            logger.warning("Read chain: %s", step.error)
        return step

    def _step_role_rules(self, agent_name: str, result: ReadChainResult) -> StepResult:
        """Step 3: Read rules/<agent_name>.md (role-specific rules)."""
        path = self._root / "rules" / f"{agent_name}.md"
        step = StepResult(name=f"rules/{agent_name}.md", required=False, loaded=False)
        try:
            text = path.read_text(encoding="utf-8")
            result.role_rules = text
            step.content = text
            step.loaded = True
        except FileNotFoundError:
            step.error = "No role-specific rules file"
        except (OSError, ValueError) as exc:
            step.error = f"Failed to read role rules: {exc}"
        return step

    def _step_memory(self, agent_name: str, result: ReadChainResult) -> StepResult:
        """Step 4: Read agents/<agent_name>/memory.md."""
        path = self._root / "agents" / agent_name / "memory.md"
        step = StepResult(name=f"agents/{agent_name}/memory.md", required=False, loaded=False)
        try:
            text = path.read_text(encoding="utf-8")
            result.memory = text
            step.content = text
            step.loaded = True
        except FileNotFoundError:
            step.error = "No memory file"
        except (OSError, ValueError) as exc:
            step.error = f"Failed to read memory: {exc}"
        return step

    def _step_folder_index(self, target_path: Path, result: ReadChainResult) -> StepResult:
        """Step 5: Read _index.md of the target folder."""
        # Determine the folder — if target_path is a file, use its parent
        folder = target_path if target_path.is_dir() else target_path.parent
        index_path = folder / "_index.md"
        step = StepResult(name=f"_index.md ({folder.name}/)", required=False, loaded=False)
        try:
            text = index_path.read_text(encoding="utf-8")
            result.folder_index = text
            step.content = text
            step.loaded = True
        except FileNotFoundError:
            step.error = "No _index.md in target folder"
        except (OSError, ValueError) as exc:
            step.error = f"Failed to read folder index: {exc}"
        return step

    def _step_related_notes(self, target_path: Path, result: ReadChainResult) -> StepResult:
        """Step 6: Read notes linked via wikilinks from the target area."""
        step = StepResult(name="related notes", required=False, loaded=False)
        related: list[dict[str, Any]] = []

        try:
            # If target is a file that exists, parse it for wikilinks
            if target_path.is_file() and target_path.suffix == ".md":
                note = parse_note(target_path)
                wikilinks = note.wikilinks[:MAX_RELATED_NOTES]

                threads_dir = self._root / "threads"
                if threads_dir.exists():
                    # Use cached index if available, else fall back to rglob
                    title_map = self._get_title_map(threads_dir)
                    for link_text in wikilinks:
                        linked_path = title_map.get(link_text.lower())
                        if linked_path and linked_path != target_path:
                            linked = parse_note(linked_path)
                            related.append(
                                {
                                    "title": linked.title,
                                    "id": linked.id,
                                    "body": linked.body[:2000],
                                }
                            )

            result.related_notes = related
            step.loaded = True
            step.content = f"{len(related)} related note(s) loaded"
        except (OSError, yaml.YAMLError, ValidationError, ValueError) as exc:
            step.error = f"Failed to resolve related notes: {exc}"

        return step

    def _get_title_map(self, threads_dir: Path) -> dict[str, Path]:
        """Return a title→path map, preferring the cached NoteIndex."""
        if self._note_index is not None and self._note_index.size > 0:
            return self._note_index.get_title_map()
        return self._build_title_map_from_disk(threads_dir)

    @staticmethod
    def _build_title_map_from_disk(threads_dir: Path) -> dict[str, Path]:
        """Build a lowercase-title → path map from all .md files in threads/."""
        from core.notes import parse_note_meta

        title_map: dict[str, Path] = {}
        for md in threads_dir.rglob("*.md"):
            if ".archive" in md.parts:
                continue
            try:
                meta = parse_note_meta(md)
                if meta.title:
                    title_map[meta.title.lower()] = md
            except (OSError, yaml.YAMLError, ValidationError, ValueError):
                continue
        return title_map
