from pathlib import Path

import pytest

from evals.runner import DEFAULT_CASES, evaluate, load_cases


def test_capture_quality_cases_are_versioned() -> None:
    cases = load_cases(DEFAULT_CASES)
    assert {case["id"] for case in cases} == {
        "distributed-systems-topic",
        "delivery-project",
        "person-conversation",
    }


@pytest.mark.asyncio
async def test_fixture_quality_evaluation_passes(tmp_path: Path) -> None:
    report = await evaluate(DEFAULT_CASES, "fixture", 0.9)
    assert report.passed
    assert report.score == 1.0
    assert all(case.latency_ms >= 0 for case in report.cases)
