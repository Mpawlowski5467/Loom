"""Run repeatable semantic evaluations against Loom's real agent pipeline.

The fixture mode is deterministic and suitable for CI: it protects prompt
parsing, schema enforcement, filing, linking, and pipeline orchestration. The
configured mode uses Loom's active chat provider and is intended for release
qualification and model bake-offs. It never writes into the user's vault.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import tempfile
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import yaml

from agents.loom.archivist import init_archivist
from agents.loom.scribe import init_scribe
from agents.loom.sentinel import init_sentinel
from agents.loom.spider import init_spider
from agents.loom.weaver import init_weaver
from agents.runner import AgentRunner
from core.config import LoomSettings
from core.note_index import get_note_index
from core.notes import parse_note
from core.providers.base import BaseProvider
from core.vault import VaultManager

DEFAULT_CASES = Path(__file__).with_name("capture_quality.yaml")


class FixtureProvider(BaseProvider):
    """Provider that replays a case's captured model responses in order."""

    name = "evaluation-fixture"

    def __init__(self, responses: list[str]) -> None:
        self._responses = iter(responses)

    async def embed(self, text: str) -> list[float]:  # noqa: ARG002
        return [0.0] * 8

    async def chat(self, messages: list[dict[str, Any]], system: str = "") -> str:  # noqa: ARG002
        try:
            return next(self._responses)
        except StopIteration as exc:
            raise RuntimeError("Evaluation fixture exhausted its responses") from exc


@dataclass(slots=True)
class Check:
    name: str
    passed: bool
    expected: Any
    actual: Any


@dataclass(slots=True)
class CaseResult:
    case_id: str
    score: float
    latency_ms: int
    checks: list[Check] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


@dataclass(slots=True)
class EvaluationReport:
    mode: str
    score: float
    passed: bool
    threshold: float
    cases: list[CaseResult]


def load_cases(path: Path) -> list[dict[str, Any]]:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or raw.get("version") != 1:
        raise ValueError("Evaluation file must be a version: 1 mapping")
    cases = raw.get("cases")
    if not isinstance(cases, list) or not cases:
        raise ValueError("Evaluation file must contain at least one case")
    return [case for case in cases if isinstance(case, dict)]


def _provider(mode: str, case: dict[str, Any]) -> BaseProvider | None:
    if mode == "fixture":
        responses = case.get("fixture_responses")
        if not isinstance(responses, list) or not all(isinstance(r, str) for r in responses):
            raise ValueError(f"Case {case.get('id')} has no valid fixture_responses")
        return FixtureProvider(responses)
    if mode == "heuristic":
        return None
    from core.providers import get_chat_provider

    return get_chat_provider()


def _check(name: str, expected: Any, actual: Any, passed: bool) -> Check:
    return Check(name=name, expected=expected, actual=actual, passed=passed)


async def evaluate_case(case: dict[str, Any], mode: str) -> CaseResult:
    started = time.perf_counter()
    checks: list[Check] = []
    errors: list[str] = []
    case_id = str(case.get("id") or "unnamed")
    try:
        with tempfile.TemporaryDirectory(prefix="loom-eval-") as temp:
            settings = LoomSettings(loom_home=Path(temp) / ".loom")
            manager = VaultManager(settings=settings)
            root = manager.init_vault("evaluation")
            manager.set_active_vault("evaluation")
            get_note_index().build(root / "threads")

            provider = _provider(mode, case)
            init_weaver(root, provider)
            init_spider(root, None)
            init_archivist(root, None)
            init_scribe(root, None)
            init_sentinel(root, provider)

            capture = case.get("capture") or {}
            from core.capture_ingress import ingest_capture

            ingress = await ingest_capture(
                root,
                title=str(capture.get("title") or case_id),
                body=str(capture.get("body") or ""),
                source="evaluation",
                external_id=case_id,
            )
            result = await AgentRunner(root).run_pipeline(ingress.capture_path)
            expected = case.get("expected") or {}
            note = result.note
            if note is None:
                errors.extend(result.errors or ["Pipeline did not produce a note"])
            else:
                # Reparse the durable artifact: the evaluator grades what Loom
                # stored, not the transient in-memory response.
                note = parse_note(Path(note.file_path))
                expected_type = str(expected.get("type") or "")
                expected_folder = str(expected.get("folder") or "")
                expected_title = str(expected.get("title") or "")
                checks.extend(
                    [
                        _check("type", expected_type, note.type, note.type == expected_type),
                        _check(
                            "folder",
                            expected_folder,
                            Path(note.file_path).parent.name,
                            Path(note.file_path).parent.name == expected_folder,
                        ),
                        _check("title", expected_title, note.title, note.title == expected_title),
                    ]
                )
                for tag in expected.get("tags") or []:
                    checks.append(_check(f"tag:{tag}", tag, note.tags, tag in note.tags))
                body_lower = note.body.lower()
                for heading in expected.get("headings") or []:
                    marker = f"## {heading}".lower()
                    checks.append(
                        _check(f"heading:{heading}", marker, note.body, marker in body_lower)
                    )
                for link in expected.get("links") or []:
                    checks.append(
                        _check(f"link:{link}", link, note.wikilinks, link in note.wikilinks)
                    )

            verdict = result.validation.status if result.validation else "missing"
            accepted = [str(value) for value in expected.get("sentinel") or []]
            checks.append(_check("sentinel", accepted, verdict, verdict in accepted))
            errors.extend(result.errors)
    except Exception as exc:  # noqa: BLE001 - evaluator must report every case
        errors.append(f"{exc.__class__.__name__}: {exc}")

    passed_checks = sum(check.passed for check in checks)
    score = passed_checks / len(checks) if checks else 0.0
    return CaseResult(
        case_id=case_id,
        score=round(score, 4),
        latency_ms=round((time.perf_counter() - started) * 1000),
        checks=checks,
        errors=errors,
    )


async def evaluate(path: Path, mode: str, threshold: float) -> EvaluationReport:
    results = [await evaluate_case(case, mode) for case in load_cases(path)]
    score = sum(result.score for result in results) / len(results)
    passed = score >= threshold and all(not result.errors for result in results)
    return EvaluationReport(
        mode=mode,
        score=round(score, 4),
        passed=passed,
        threshold=threshold,
        cases=results,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    parser.add_argument("--mode", choices=("fixture", "heuristic", "configured"), default="fixture")
    parser.add_argument("--threshold", type=float, default=0.9)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    report = asyncio.run(evaluate(args.cases, args.mode, args.threshold))
    payload = json.dumps(asdict(report), indent=2)
    if args.output:
        args.output.write_text(payload + "\n", encoding="utf-8")
    print(payload)
    raise SystemExit(0 if report.passed else 1)


if __name__ == "__main__":
    main()
