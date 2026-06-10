"""Researcher agent: queries the vault and synthesizes answers.

Shuttle-layer agent. Writes only to captures/. Loom agents process from there.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

import yaml
from pydantic import ValidationError

from agents.base import BaseAgent
from core.exceptions import ProviderConfigError, ProviderError
from core.notes import generate_id, now_iso
from core.vault_io import write_note

if TYPE_CHECKING:
    from pathlib import Path

    from agents.chain import ReadChainResult
    from core.providers import BaseProvider

logger = logging.getLogger(__name__)

_RESEARCH_SYSTEM = """\
You are the Researcher agent in a knowledge management system. Your job is to
answer questions by synthesizing information from vault notes.

Given a question and relevant context from the vault, provide a clear and
thorough answer. Rules:

- Cite your sources using [[wikilinks]] to the notes you reference
- If the vault doesn't contain enough information, say so honestly
- Be concise but complete
- Organize your answer with clear structure if it's complex
- Do not invent facts — only use information from the provided context
"""


def _assert_capture_path(path: Path) -> None:
    """Enforce the Shuttle tier boundary: writes must land under captures/.

    ``vault_io.write_note`` already constrains writes to ``threads/*.md``;
    this narrows it to ``threads/captures/`` specifically, documenting and
    enforcing in code that Shuttle agents never touch note folders directly.
    """
    if "captures" not in path.parts:
        raise ValueError(f"Shuttle agents may only write under captures/, got {path}")


@dataclass
class ResearchResult:
    """Result of a Researcher query."""

    answer: str
    referenced_notes: list[dict[str, Any]] = field(default_factory=list)
    capture_id: str = ""
    capture_path: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "answer": self.answer,
            "referenced_notes": self.referenced_notes,
            "capture_id": self.capture_id,
            "capture_path": self.capture_path,
        }


class Researcher(BaseAgent):
    """Researcher queries the vault and synthesizes answers from found context."""

    # Read chain for the in-flight query, stashed so the graph's synthesize
    # node can reach it without threading a heavy object through graph state.
    _last_chain: ReadChainResult | None = None

    @property
    def name(self) -> str:
        return "researcher"

    @property
    def role(self) -> str:
        return "Research: queries vault knowledge and synthesizes answers"

    async def query(self, question: str) -> ResearchResult:
        """Search the vault, synthesize an answer, and save findings to captures/.

        Args:
            question: The user's question.

        Returns:
            ResearchResult with the answer, referenced notes, and capture path.
        """
        captures_dir = self._vault_root / "threads" / "captures"
        captures_dir.mkdir(parents=True, exist_ok=True)

        async def _action(chain: ReadChainResult) -> dict[str, Any]:
            from agents.shuttle.graph_runtime import run_scope
            from agents.shuttle.researcher_graph import build_researcher_graph

            # Stash the read chain so the synthesize node can reach it without
            # threading a heavy object through graph state.
            self._last_chain = chain
            graph = build_researcher_graph(self)

            async with run_scope("researcher"):
                final = await graph.ainvoke({"question": question})

            refs = final.get("refs", [])
            return {
                "action": "researched",
                "details": f"Answered '{question[:60]}' citing {len(refs)} note(s)",
                "result": ResearchResult(
                    answer=final.get("answer", ""),
                    referenced_notes=refs,
                    capture_id=final.get("capture_id", ""),
                    capture_path=final.get("capture_path", ""),
                ),
            }

        result = await self.execute_with_chain(captures_dir, _action)
        research_result: ResearchResult = result.get(
            "result", ResearchResult(answer="Research failed.")
        )
        return research_result

    async def _search_vault(self, question: str) -> tuple[str, list[dict[str, Any]]]:
        """Search the vault index for notes relevant to the question."""
        from index.searcher import get_searcher

        searcher = get_searcher()
        refs: list[dict[str, Any]] = []

        if searcher is None:
            # Fall back to keyword search via in-memory index
            return self._keyword_search_fallback(question), refs

        try:
            results = await searcher.search(question, limit=10)
        except (ProviderError, ProviderConfigError, OSError):
            logger.warning("Semantic search failed, falling back to keyword", exc_info=True)
            return self._keyword_search_fallback(question), refs

        if not results:
            return "No relevant notes found in the vault.", refs

        # Build context string from search results
        parts: list[str] = []
        for sr in results:
            refs.append(
                {
                    "note_id": sr.note_id,
                    "heading": sr.heading,
                    "score": sr.score,
                    "note_type": sr.note_type,
                }
            )
            parts.append(f"[{sr.note_id}] {sr.heading or '(untitled section)'}\n{sr.snippet}")

        return "\n\n---\n\n".join(parts), refs

    def _keyword_search_fallback(self, question: str) -> str:
        """Basic keyword search when vector search is unavailable."""
        from core.note_index import get_note_index
        from core.notes import parse_note

        index = get_note_index()
        query_lower = question.lower()
        matches: list[str] = []

        for entry in index.all_entries():
            if query_lower in entry.title.lower() or any(
                query_lower in t.lower() for t in entry.tags
            ):
                try:
                    note = parse_note(entry.file_path)
                    matches.append(f"[{note.id}] {note.title}\n{note.body[:500]}")
                except (OSError, yaml.YAMLError, ValidationError, ValueError):
                    continue
            if len(matches) >= 5:
                break

        if not matches:
            return "No relevant notes found in the vault."
        return "\n\n---\n\n".join(matches)

    async def _synthesize(
        self,
        question: str,
        vault_context: str,
        chain: ReadChainResult,
    ) -> str:
        """Synthesize an answer from collected context."""
        if self._chat_provider is None:
            # No LLM — return raw context
            return f"## Vault Context\n\n{vault_context}"

        user_msg = (
            f"Question: {question}\n\n"
            f"Context:\n## Vault Notes\n\n{vault_context}\n\n"
            "Provide a clear answer based on the context above."
        )

        try:
            return await self._chat_provider.chat(
                messages=[{"role": "user", "content": user_msg}],
                system=_RESEARCH_SYSTEM,
            )
        except (ProviderError, ProviderConfigError):
            logger.warning("LLM synthesis failed, returning raw context", exc_info=True)
            return f"## Vault Context\n\n{vault_context}"

    def _save_capture(
        self, question: str, answer: str, refs: list[dict[str, Any]]
    ) -> tuple[str, Path]:
        """Save research findings as a capture note."""
        captures_dir = self._vault_root / "threads" / "captures"
        captures_dir.mkdir(parents=True, exist_ok=True)

        capture_id = generate_id()
        ts = now_iso()

        ref_links = "\n".join(f"- [{r['note_id']}]" for r in refs) if refs else "None"

        body = f"## Question\n\n{question}\n\n## Answer\n\n{answer}\n\n## Sources\n\n{ref_links}\n"

        meta = {
            "id": capture_id,
            "title": f"Research: {question[:50]}",
            "type": "capture",
            "tags": ["research"],
            "created": ts,
            "modified": ts,
            "author": "agent:researcher",
            "source": "agent:researcher",
            "links": [],
            "status": "active",
            "history": [
                {
                    "action": "created",
                    "by": "agent:researcher",
                    "at": ts,
                    "reason": "Research query",
                },
            ],
        }

        filename = f"research-{capture_id}.md"
        path = captures_dir / filename
        _assert_capture_path(path)
        write_note(self._vault_root, path, meta, body)
        return capture_id, path


_researcher: Researcher | None = None


def get_researcher() -> Researcher | None:
    return _researcher


def init_researcher(vault_root: Path, chat_provider: BaseProvider | None = None) -> Researcher:
    global _researcher
    _researcher = Researcher(vault_root, chat_provider)
    return _researcher
