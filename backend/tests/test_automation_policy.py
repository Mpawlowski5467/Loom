from __future__ import annotations

from pathlib import Path

import pytest

from core.automation_policy import (
    AutomationPausedError,
    cloud_content_allowed,
    require_capture_allowed,
)
from core.capture_ingress import CaptureIngressError, ingest_capture
from core.config import AutomationPolicyConfig
from core.traces import TraceRecord
from core.usage import UsageLedger


def test_capture_limit_is_atomic_and_source_scoped(tmp_path: Path) -> None:
    ledger = UsageLedger(tmp_path)
    assert ledger.reserve_capture("github", 1)
    assert not ledger.reserve_capture("github", 1)
    assert ledger.reserve_capture("email", 1)


def test_token_reservation_fails_closed_at_limit(tmp_path: Path) -> None:
    ledger = UsageLedger(tmp_path)
    assert ledger.reserve_tokens("openai", 8, 10)
    assert not ledger.reserve_tokens("anthropic", 3, 10)


def test_usage_is_counted_without_limits_and_cost_requires_configured_price(tmp_path: Path) -> None:
    ledger = UsageLedger(tmp_path)
    assert ledger.reserve_capture("github", 0)
    assert ledger.reserve_tokens("openai", 1000, 0)
    ledger.record_output("openai", 500)
    assert ledger.summary()["total_tokens"] == 1500
    assert ledger.summary()["captures_by_source"] == {"github": 1}
    assert ledger.summary()["priced_total"] is None
    assert ledger.summary({"openai": 0.01})["priced_total"] == 0.015


def test_automated_capture_pause_does_not_block_manual(tmp_path: Path) -> None:
    policy = AutomationPolicyConfig(paused=True)
    with pytest.raises(AutomationPausedError):
        require_capture_allowed(tmp_path, "github", policy, automated=True)
    require_capture_allowed(tmp_path, "manual", policy, automated=False)


def test_cloud_folder_and_tag_exclusions_precede_embedding(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    path = vault / "threads" / "private" / "note.md"
    policy = AutomationPolicyConfig(
        excluded_cloud_folders=["private"], excluded_cloud_tags=["secret"]
    )
    assert not cloud_content_allowed(path, [], vault, policy)
    assert not cloud_content_allowed(
        vault / "threads" / "topics" / "note.md", ["secret"], vault, policy
    )
    assert cloud_content_allowed(
        vault / "threads" / "topics" / "note.md", ["public"], vault, policy
    )


def test_metadata_only_trace_marks_content_withheld() -> None:
    record = TraceRecord("openai", "x", [], "", "", 1, content_retained=False)
    assert record.to_dict()["content_retained"] is False


@pytest.mark.asyncio
async def test_ingress_rejects_paused_automated_capture_but_keeps_manual_available(
    tmp_path: Path,
) -> None:
    root = tmp_path / "vault"
    (root / "threads" / "captures").mkdir(parents=True)
    policy = AutomationPolicyConfig(paused=True)
    with pytest.raises(CaptureIngressError, match="paused"):
        await ingest_capture(root, title="Scheduled", source="github", automation_policy=policy)
    result = await ingest_capture(
        root, title="Manual", source="manual", automation_policy=policy, automated=False
    )
    assert result.created


@pytest.mark.parametrize("price", [float("inf"), float("nan"), -1])
def test_nonfinite_or_negative_provider_prices_rejected(price):
    from pydantic import ValidationError

    from core.config import AutomationPolicyConfig

    with pytest.raises(ValidationError):
        AutomationPolicyConfig(provider_prices_per_1k={"openai": price})


@pytest.mark.asyncio
async def test_provider_usage_keeps_original_vault_when_switching_during_call(
    tmp_path, monkeypatch
):
    from types import SimpleNamespace

    from core.providers.base import BaseProvider
    from core.providers.registry import TracedProvider

    first, second = tmp_path / "first", tmp_path / "second"
    current = {"root": first}
    monkeypatch.setattr(
        "core.vault.get_vault_manager",
        lambda: SimpleNamespace(active_vault_dir=lambda: current["root"]),
    )

    class SwitchingProvider(BaseProvider):
        async def chat(self, messages, system=""):
            current["root"] = second
            return "Successful response after the vault switch"

        async def embed(self, text):
            return [0.0]

    await TracedProvider(SwitchingProvider(), "test").chat([{"role": "user", "content": "hello"}])
    usage = UsageLedger(first).summary()["tokens_by_provider"]["test"]
    assert usage["input_tokens"] > 0 and usage["output_tokens"] > 0
    assert UsageLedger(second).summary()["total_tokens"] == 0
