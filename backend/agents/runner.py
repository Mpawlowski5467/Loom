"""AgentRunner: orchestrates agent lifecycle, pipelines, and scheduled runs."""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any

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
        self.suggested: list[str] = []
        self.index_updated: bool = False
        self.validation: ValidationResult | None = None
        self.errors: list[str] = []
        # Sentinel enforcement: capture is archived unless verdict==failed.
        self.capture_archived: bool = False
        self.review_required: bool = False  # True on failed verdict
        self.flagged: bool = False  # True on warning verdict

    @property
    def success(self) -> bool:
        return self.note is not None and not self.errors and not self.review_required

    def to_dict(self) -> dict[str, Any]:
        return {
            "success": self.success,
            "note_id": self.note.id if self.note else None,
            "note_title": self.note.title if self.note else None,
            "links_added": self.links_added,
            "suggested": self.suggested,
            "index_updated": self.index_updated,
            "validation": self.validation.to_dict() if self.validation else None,
            "errors": self.errors,
            "capture_archived": self.capture_archived,
            "review_required": self.review_required,
            "flagged": self.flagged,
        }


class AgentRunner:
    """Manages agent lifecycle and orchestrates multi-agent pipelines."""

    def __init__(self, vault_root: Path) -> None:
        self._vault_root = vault_root

    def list_agents(self) -> list[dict[str, Any]]:
        """List all agents with their current status."""
        agents: list[dict[str, Any]] = []
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

    async def run_pipeline(self, capture_path: Path, refresh_index: Any = None) -> PipelineResult:
        """Run one capture transaction under a process-wide per-capture lock.

        The lock covers the idempotency check, graph side effects, validation,
        and enforcement. Two overlapping ``/process`` or ``/process-all`` calls
        for the same capture therefore cannot both create a note.
        """
        from agents.file_locks import path_lock

        async with path_lock(capture_path):
            return await self._run_pipeline_locked(capture_path, refresh_index)

    async def _run_pipeline_locked(
        self, capture_path: Path, refresh_index: Any = None
    ) -> PipelineResult:
        """Run the full capture pipeline: Weaver → Sentinel → Spider → Scribe.

        Orchestrated as a LangGraph ``StateGraph`` (see
        :mod:`agents.loom.pipeline_graph`). The graph adds a Sentinel-retry
        loop: a ``failed`` verdict routes back to Weaver once to regenerate the
        note, then re-validates; if it still fails the capture stays in the
        inbox flagged for review. Each step is recorded under one run id, so the
        whole pipeline shows up as a connected run in the Runs view.

        Idempotent on re-run: if a previous run already created the note but
        crashed before archiving the capture, re-processing detects the existing
        note (by capture-id source) and finishes enforcement only, instead of
        creating a duplicate.

        ``refresh_index`` is an optional ``Callable[[Path], None]`` the live
        endpoint passes to keep the search index hot after writes.
        """
        from agents.loom.pipeline_graph import build_pipeline_graph
        from agents.shuttle.graph_runtime import run_scope, step

        result = PipelineResult()

        # Idempotency guard: an already-archived capture is a no-op. (The file
        # is moved out of captures/ only after a successful archive.)
        if not capture_path.exists():
            return result

        # A missing Weaver is handled inside the graph's weaver node (it records
        # the error and short-circuits to END); we don't pre-check here so a
        # test patching agents.loom.weaver.get_weaver is honored — the graph
        # imports the getter lazily at build time, this module's top-level
        # import would hold a stale reference.

        # If this capture was already filed (crash between note-write and
        # archive), reuse the existing note and finish enforcement only — keyed
        # on the stable capture id, never the title. This bypasses the graph
        # (Weaver must not re-create) but still records a run for visibility.
        existing = self._existing_note_for_capture(capture_path)
        if existing is not None:
            logger.info(
                "Capture %s already filed as note %s — finishing enforcement only",
                capture_path.name,
                existing.id,
            )
            result.note = existing
            note_path = _resolve_path(existing.file_path)
            async with run_scope("pipeline"):
                async with step("sentinel", caller="sentinel") as record:
                    result.validation = await self._validate_existing_note(note_path, result.errors)
                    if result.validation.status == "unavailable":
                        record.status = "error"
                        record.error = "; ".join(result.validation.reasons)
                async with step("enforce"):
                    self._enforce_into_result(capture_path, note_path, result.validation, result)
            return result

        graph = build_pipeline_graph(self, refresh_index)
        async with run_scope("pipeline"):
            final = await graph.ainvoke({"capture_path": str(capture_path), "errors": []})

        result.note = final.get("note")
        result.links_added = final.get("linked", [])
        result.suggested = final.get("suggested", [])
        result.index_updated = final.get("index_updated", False)
        result.validation = final.get("validation")
        result.errors = final.get("errors", [])
        # Enforcement ran inside the graph's enforce node and mutated the
        # PipelineResult flags via _enforce_into_result; mirror them back here.
        result.capture_archived = bool(final.get("capture_archived", result.capture_archived))
        result.review_required = bool(final.get("review_required", result.review_required))
        result.flagged = bool(final.get("flagged", result.flagged))
        return result

    async def _validate_existing_note(self, note_path: Path, errors: list[str]) -> ValidationResult:
        """Revalidate a note found by the idempotency guard before enforcement.

        A prior run may have stopped after writing the note but before Sentinel
        or capture archival. Crash recovery must not treat that missing verdict
        as approval, so it reconstructs the read chain and asks Sentinel again.
        """
        from agents.chain import ReadChain
        from agents.loom.sentinel import ValidationResult, get_sentinel

        sentinel = get_sentinel()
        if sentinel is None:
            message = "Sentinel agent not initialized"
            errors.append(message)
            return ValidationResult(
                status="unavailable",
                reasons=[message],
                agent_name="weaver",
                action="created",
                target=str(note_path),
                modes=["unavailable"],
            )

        try:
            chain = await asyncio.to_thread(
                ReadChain(self._vault_root).execute, "weaver", note_path
            )
            return await sentinel.validate_action("weaver", "created", note_path, chain)
        except Exception as exc:  # noqa: BLE001 - convert recovery failure to a safe verdict
            logger.warning("Sentinel failed while resuming pipeline", exc_info=True)
            message = f"Sentinel failed: {exc}"
            errors.append(message)
            return ValidationResult(
                status="unavailable",
                reasons=[message],
                agent_name="weaver",
                action="created",
                target=str(note_path),
                modes=["unavailable"],
            )

    def _enforce_verdict(
        self,
        capture_path: Path,
        note_path: Path | None,
        validation: ValidationResult | None,
        errors: list[str],
    ) -> dict[str, bool]:
        """Graph enforce-node hook: apply Sentinel's verdict, return flag deltas.

        Returns a dict the graph merges into state so run_pipeline can mirror
        the enforcement outcome onto its PipelineResult.
        """
        from agents.loom.enforcement import enforce_verdict

        verdict = validation.status if validation else ""
        reasons = list(validation.reasons) if validation else []
        outcome = enforce_verdict(self._vault_root, capture_path, note_path, verdict, reasons)
        return {
            "capture_archived": outcome.capture_archived,
            "review_required": outcome.review_required,
            "flagged": outcome.flagged,
        }

    def _enforce_into_result(
        self,
        capture_path: Path,
        note_path: Path | None,
        validation: ValidationResult | None,
        result: PipelineResult,
    ) -> None:
        """Enforce a verdict and write the flags straight onto a PipelineResult.

        Used by the idempotent already-filed branch, which doesn't run the graph.
        """
        flags = self._enforce_verdict(capture_path, note_path, validation, result.errors)
        result.capture_archived = flags["capture_archived"]
        result.review_required = flags["review_required"]
        result.flagged = flags["flagged"]

    async def run_scheduled(self, agent_name: str, **kwargs: Any) -> dict[str, Any]:
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
            scribe_date: date | None = kwargs.get("date")
            if scribe_date is None:
                from datetime import date as date_cls

                from core.notes import now_iso

                scribe_date = date_cls.fromisoformat(now_iso()[:10])
            content = await scribe.generate_daily_log(scribe_date)
            return {"date": scribe_date.isoformat(), "content": content}

        if agent_name == "spider":
            spider = get_spider()
            if spider is None:
                return {"error": "Spider not initialized"}
            vault_report = await spider.scan_vault_report()
            return vault_report.to_dict()

        if agent_name == "standup":
            standup = get_standup()
            if standup is None:
                return {"error": "Standup not initialized"}
            standup_date: date | None = kwargs.get("date")
            # standup.generate(None) defaults to UTC date internally
            result = await standup.generate(standup_date)
            return result.to_dict()

        # Not a built-in — try the user-defined custom-agent registry. Custom
        # agents are Shuttle-tier: they write to captures/ only, and Loom agents
        # process from there.
        record = self._lookup_custom_record(agent_name)
        if record is not None:
            from agents.shuttle.custom import CustomAgent

            agent = CustomAgent(self._vault_root, record, _get_chat_provider(agent_name, record))
            run_result = await agent.run()
            return run_result.to_dict()

        return {"error": f"Unknown agent or not schedulable: {agent_name}"}

    def _existing_note_for_capture(self, capture_path: Path) -> Note | None:
        """Return a note already created from this capture, or None.

        Parses the capture's stable frontmatter id and looks for a note whose
        ``source`` is ``capture:{id}`` (the marker Weaver writes). Best-effort:
        a missing/unparseable capture or missing note file yields None, so the
        pipeline falls back to normal creation.
        """
        from agents.loom.weaver_io import find_note_by_capture_source
        from core.notes import parse_note, parse_note_meta

        try:
            capture_id = parse_note_meta(capture_path).id
        except (OSError, ValueError):
            return None
        meta = find_note_by_capture_source(self._vault_root, capture_id)
        if meta is None or not meta.file_path:
            return None
        note_file = _resolve_path(meta.file_path)
        if not note_file.exists():
            return None
        try:
            return parse_note(note_file)
        except (OSError, ValueError):
            return None

    def _lookup_custom_record(self, agent_name: str) -> dict[str, Any] | None:
        """Find a custom agent by id in ``agents.yaml`` next to vault.yaml."""
        import yaml

        agents_file = self._vault_root / "agents.yaml"
        if not agents_file.exists():
            return None
        try:
            data = yaml.safe_load(agents_file.read_text()) or {}
        except yaml.YAMLError:
            logger.warning("agents.yaml is malformed; cannot run custom agents")
            return None
        items = data.get("agents") if isinstance(data, dict) else None
        if not isinstance(items, list):
            return None
        for raw in items:
            if isinstance(raw, dict) and raw.get("id") == agent_name:
                return raw
        return None


def _get_chat_provider(agent_id: str = "", record: dict[str, Any] | None = None) -> Any:
    """Best-effort chat provider for custom-agent runs; None if unavailable.

    Resolution order: ``GlobalConfig.agent_models[agent_id]`` override, then
    ``provider``/``chat_model`` fields on the agent's ``agents.yaml`` record,
    then the global default chat provider.
    """
    try:
        from core.providers import get_registry

        rec = record or {}
        return get_registry().get_chat_provider_for(
            agent_id,
            provider=str(rec.get("provider") or "") or None,
            chat_model=str(rec.get("chat_model") or "") or None,
        )
    except Exception:
        return None


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
