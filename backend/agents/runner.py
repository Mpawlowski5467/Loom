"""AgentRunner: orchestrates agent lifecycle, pipelines, and scheduled runs."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from agents.loom.archivist import get_archivist
from agents.loom.scribe import get_scribe
from agents.loom.sentinel import get_sentinel
from agents.loom.spider import get_spider
from agents.loom.weaver import get_weaver
from agents.shuttle.researcher import get_researcher
from agents.shuttle.standup import get_standup

if TYPE_CHECKING:
    from datetime import date
    from pathlib import Path

    from agents.loom.sentinel import ValidationResult
    from core.notes import Note

logger = logging.getLogger(__name__)


class PipelineResult:
    """Result of a full capture-to-note pipeline run."""

    def __init__(self) -> None:
        self.note: Note | None = None
        self.links_added: list[str] = []
        self.index_updated: bool = False
        self.validation: ValidationResult | None = None
        self.errors: list[str] = []

    @property
    def success(self) -> bool:
        return self.note is not None and not self.errors

    def to_dict(self) -> dict:
        return {
            "success": self.success,
            "note_id": self.note.id if self.note else None,
            "note_title": self.note.title if self.note else None,
            "links_added": self.links_added,
            "index_updated": self.index_updated,
            "validation": self.validation.to_dict() if self.validation else None,
            "errors": self.errors,
        }


class AgentRunner:
    """Manages agent lifecycle and orchestrates multi-agent pipelines."""

    def __init__(self, vault_root: Path) -> None:
        self._vault_root = vault_root

    def list_agents(self) -> list[dict]:
        """List all agents with their current status."""
        agents: list[dict] = []
        for getter, role in [
            (get_weaver, "creator"),
            (get_spider, "linker"),
            (get_archivist, "organizer"),
            (get_scribe, "summarizer"),
            (get_sentinel, "reviewer"),
            (get_researcher, "research"),
            (get_standup, "daily recap"),
        ]:
            agent = getter()
            if agent is not None:
                agents.append(
                    {
                        "name": agent.name,
                        "role": role,
                        "enabled": agent.config.enabled,
                        "trust_level": agent.trust_level,
                        "action_count": agent.state.action_count,
                        "last_action": agent.state.last_action,
                    }
                )
            else:
                name = getter.__module__.rsplit(".", 1)[-1]
                agents.append(
                    {
                        "name": name,
                        "role": role,
                        "enabled": False,
                        "trust_level": "standard",
                        "action_count": 0,
                        "last_action": None,
                    }
                )
        return agents

    async def run_pipeline(self, capture_path: Path) -> PipelineResult:
        """Run the full capture pipeline: Weaver → Spider → Scribe → Sentinel.

        Steps:
          1. Weaver processes capture into a structured note
          2. Spider scans the new note for connections
          3. Scribe updates the target folder's _index.md
          4. Sentinel validates the created note
        """
        result = PipelineResult()

        # Step 1: Weaver processes capture
        weaver = get_weaver()
        if weaver is None:
            result.errors.append("Weaver agent not initialized")
            return result

        try:
            note = await weaver.process_capture(capture_path)
            if note is None:
                result.errors.append("Weaver returned no note (empty capture?)")
                return result
            result.note = note
        except Exception as exc:  # noqa: BLE001
            result.errors.append(f"Weaver failed: {exc}")
            return result

        note_path = _resolve_path(note.file_path)

        # Step 2: Spider links
        spider = get_spider()
        if spider is not None:
            try:
                result.links_added = await spider.scan_for_connections(note_path)
            except Exception as exc:  # noqa: BLE001
                result.errors.append(f"Spider failed: {exc}")

        # Step 3: Scribe updates folder index
        scribe = get_scribe()
        if scribe is not None:
            try:
                folder_path = note_path.parent
                await scribe.update_index(folder_path)
                result.index_updated = True
            except Exception as exc:  # noqa: BLE001
                result.errors.append(f"Scribe failed: {exc}")

        # Step 4: Sentinel validates
        sentinel = get_sentinel()
        if sentinel is not None:
            try:
                # Re-run chain for validation context
                from agents.chain import ReadChain

                chain = ReadChain(self._vault_root)
                chain_result = chain.execute("sentinel", note_path)
                result.validation = await sentinel.validate_action(
                    "weaver", "created", note_path, chain_result
                )
            except Exception as exc:  # noqa: BLE001
                result.errors.append(f"Sentinel failed: {exc}")

        return result

    async def run_scheduled(self, agent_name: str, **kwargs) -> dict:
        """Trigger a scheduled agent run by name.

        Supported agents:
          - archivist: full vault audit
          - scribe: daily log generation (pass date=<date>)
          - spider: full vault scan for connections
        """
        if agent_name == "archivist":
            archivist = get_archivist()
            if archivist is None:
                return {"error": "Archivist not initialized"}
            audit = await archivist.audit_vault()
            return audit.to_dict()

        if agent_name == "scribe":
            scribe = get_scribe()
            if scribe is None:
                return {"error": "Scribe not initialized"}
            target_date: date = kwargs.get("date")  # type: ignore[assignment]
            if target_date is None:
                from datetime import date as date_cls

                from core.notes import now_iso

                target_date = date_cls.fromisoformat(now_iso()[:10])
            content = await scribe.generate_daily_log(target_date)
            return {"date": target_date.isoformat(), "content": content}

        if agent_name == "spider":
            spider = get_spider()
            if spider is None:
                return {"error": "Spider not initialized"}
            total = await spider.scan_vault()
            return {"links_added": total}

        if agent_name == "standup":
            standup = get_standup()
            if standup is None:
                return {"error": "Standup not initialized"}
            target_date: date = kwargs.get("date")  # type: ignore[assignment]
            # standup.generate(None) defaults to UTC date internally
            result = await standup.generate(target_date)
            return result.to_dict()

        return {"error": f"Unknown agent or not schedulable: {agent_name}"}


def _resolve_path(file_path: str) -> Path:
    """Convert a string file_path to a Path."""
    from pathlib import Path

    return Path(file_path)


_runner: AgentRunner | None = None


def get_runner() -> AgentRunner | None:
    return _runner


def init_runner(vault_root: Path) -> AgentRunner:
    global _runner
    _runner = AgentRunner(vault_root)
    return _runner
