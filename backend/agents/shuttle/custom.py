"""Custom user-defined Shuttle agent.

User-defined agents registered via the Board "Add agent" modal persist to
``agents.yaml``. This module gives them execution: when run, a custom agent
takes its ``system_prompt``, gathers light vault context, makes one chat-
provider call, and writes the output to ``captures/`` for triage.

Like every Shuttle-layer agent, it writes ONLY to captures/ — Loom agents
(Weaver et al.) process from there. It never mutates existing notes.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, cast

from agents.base import BaseAgent
from core.exceptions import ProviderConfigError, ProviderError
from core.notes import generate_id, now_iso
from core.vault_io import write_note

if TYPE_CHECKING:
    from pathlib import Path

    from agents.chain import ReadChainResult
    from core.providers import BaseProvider

logger = logging.getLogger(__name__)

# Hard cap on vault context fed to the model — keeps custom-agent runs cheap
# and bounded regardless of vault size.
_MAX_CONTEXT_NOTES = 8
_MAX_NOTE_CHARS = 600


def _assert_capture_path(path: Path) -> None:
    """Enforce the Shuttle tier boundary: writes must land under captures/.

    ``vault_io.write_note`` already constrains writes to ``threads/*.md``;
    this narrows it to ``threads/captures/`` specifically, documenting and
    enforcing in code that Shuttle agents never touch note folders directly.
    """
    if "captures" not in path.parts:
        raise ValueError(f"Shuttle agents may only write under captures/, got {path}")


@dataclass
class CustomRunResult:
    """Result of a custom-agent run."""

    output: str
    capture_id: str = ""
    capture_path: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "output": self.output,
            "capture_id": self.capture_id,
            "capture_path": self.capture_path,
        }


class CustomAgent(BaseAgent):
    """A user-defined Shuttle agent driven by its stored ``system_prompt``."""

    def __init__(
        self,
        vault_root: Path,
        record: dict[str, Any],
        chat_provider: BaseProvider | None = None,
    ) -> None:
        # ``name`` is read by BaseAgent.__init__ (for the agent dir), so set the
        # identity fields before calling super().
        self._id = str(record.get("id") or record.get("name") or "custom")
        self._display_name = str(record.get("name") or self._id)
        self._role = str(record.get("role") or "custom user-defined agent")
        self._system_prompt = str(record.get("system_prompt") or "").strip()
        super().__init__(vault_root, chat_provider)

    @property
    def name(self) -> str:
        return self._id

    @property
    def role(self) -> str:
        return self._role

    async def run(self) -> CustomRunResult:
        """Execute the agent's prompt against vault context, saving a capture."""
        captures_dir = self._vault_root / "threads" / "captures"
        captures_dir.mkdir(parents=True, exist_ok=True)

        async def _action(chain: ReadChainResult) -> dict[str, Any]:
            context = self._gather_context()
            output = await self._generate(context, chain)
            capture_id, capture_path = self._save_capture(output)
            return {
                "action": "ran",
                "details": f"{self._display_name} produced a capture",
                "result": CustomRunResult(
                    output=output,
                    capture_id=capture_id,
                    capture_path=str(capture_path),
                ),
            }

        result = await self.execute_with_chain(captures_dir, _action)
        return cast(CustomRunResult, result.get("result", CustomRunResult(output="Run failed.")))

    def _gather_context(self) -> str:
        """A compact digest of recent vault notes for the model to work from."""
        from core.note_index import get_note_index
        from core.notes import parse_note

        index = get_note_index()
        if index is None:
            return "No vault notes available."

        entries = list(index.all_entries())
        # Most-recently-modified first; bounded. IndexEntry has no ``modified``
        # attribute — the real field is the frontmatter timestamp on ``meta``
        # (ISO8601, so it sorts lexically).
        entries.sort(key=lambda e: e.meta.modified or "", reverse=True)
        parts: list[str] = []
        for entry in entries[:_MAX_CONTEXT_NOTES]:
            try:
                note = parse_note(entry.file_path)
            except (OSError, ValueError):
                continue
            parts.append(f"[{note.id}] {note.title}\n{note.body[:_MAX_NOTE_CHARS]}")
        if not parts:
            return "The vault is empty."
        return "\n\n---\n\n".join(parts)

    async def _generate(self, context: str, chain: ReadChainResult) -> str:
        """One chat call using the agent's own system prompt."""
        system = self._system_prompt or (
            f"You are {self._display_name}, a custom agent in a knowledge "
            "management system. Produce a useful note from the vault context."
        )
        if self._chat_provider is None:
            # No LLM configured — emit the context so the run still yields
            # something reviewable rather than failing opaquely.
            return f"## Context (no chat provider configured)\n\n{context}"

        user_msg = (
            "Here is recent context from the vault. Produce your output as "
            "Markdown, citing notes with [[wikilinks]] where relevant.\n\n"
            f"{context}"
        )
        try:
            return await self._chat_provider.chat(
                messages=[{"role": "user", "content": user_msg}],
                system=system,
            )
        except (ProviderError, ProviderConfigError):
            logger.warning(
                "Custom agent '%s' LLM call failed; emitting context",
                self._id,
                exc_info=True,
            )
            return f"## Context (generation failed)\n\n{context}"

    def _save_capture(self, output: str) -> tuple[str, Path]:
        """Write the agent's output to captures/ with full frontmatter."""
        captures_dir = self._vault_root / "threads" / "captures"
        captures_dir.mkdir(parents=True, exist_ok=True)

        capture_id = generate_id()
        ts = now_iso()
        author = f"agent:{self._id}"
        body = f"## {self._display_name}\n\n{output}\n"
        meta = {
            "id": capture_id,
            "title": f"{self._display_name}: run {ts[:10]}",
            "type": "capture",
            "tags": ["custom-agent", self._id],
            "created": ts,
            "modified": ts,
            "author": author,
            "source": author,
            "links": [],
            "status": "active",
            "history": [
                {
                    "action": "created",
                    "by": author,
                    "at": ts,
                    "reason": "Custom agent run",
                },
            ],
        }
        path = captures_dir / f"{self._id}-{capture_id}.md"
        _assert_capture_path(path)
        write_note(self._vault_root, path, meta, body)
        return capture_id, path
