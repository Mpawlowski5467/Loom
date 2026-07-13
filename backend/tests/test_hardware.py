"""Tests for core/hardware.py and core/model_advisor.py."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import core.hardware as hw
from core.hardware import HardwareProfile, scan_hardware
from core.model_advisor import (
    BUILTIN_AGENT_MODEL_PROFILES,
    CURATED_OLLAMA_MODELS,
    ModelFit,
    estimate_model_ram_gb,
    is_embed_model_name,
    rank_models_for_builtin_agent,
    rate_model,
)

# ---------------------------------------------------------------------------
# estimate_model_ram_gb
# ---------------------------------------------------------------------------


class TestEstimateModelRam:
    @pytest.mark.parametrize(
        ("name", "size_bytes", "parameter_size", "expected"),
        [
            # parameter_size metadata: params * 0.75 + 1.5
            ("qwen2.5:7b", None, "7.6B", 7.2),
            ("llama3.1:8b", None, "8.0B", 7.5),
            # M-suffixed metadata converts to billions
            ("nomic-embed-text", None, "137M", 1.6),
            # name regex fallback
            ("qwen2.5:14b", None, None, 12.0),
            ("llama3.1:8b", None, None, 7.5),
            # disk size fallback: bytes/GiB * 1.2
            ("mystery-model", 4_000_000_000, None, 4.5),
            # nothing known → conservative default
            ("mystery-model", None, None, 4.0),
        ],
    )
    def test_estimates(
        self,
        name: str,
        size_bytes: int | None,
        parameter_size: str | None,
        expected: float,
    ) -> None:
        assert estimate_model_ram_gb(name, size_bytes, parameter_size) == expected

    def test_parameter_size_wins_over_name(self) -> None:
        """Explicit metadata beats the size embedded in the model name."""
        assert estimate_model_ram_gb("llama3.1:8b", None, "70B") == 54.0

    def test_name_wins_over_size_bytes(self) -> None:
        """A parseable name beats the disk-size heuristic."""
        assert estimate_model_ram_gb("qwen2.5:14b", 100_000_000_000, None) == 12.0

    def test_curated_models_all_estimate(self) -> None:
        for name, param_size in CURATED_OLLAMA_MODELS:
            assert estimate_model_ram_gb(name, None, param_size) > 0


# ---------------------------------------------------------------------------
# rate_model
# ---------------------------------------------------------------------------


def _profile(
    ram_gb: float,
    vram_gb: float | None = None,
    unified: bool = False,
) -> HardwareProfile:
    return HardwareProfile(
        scanned_at="2026-07-05T00:00:00+00:00",
        os="test",
        cpu_model="test",
        cpu_cores=8,
        ram_gb=ram_gb,
        vram_gb=vram_gb,
        unified_memory=unified,
    )


class TestRateModel:
    @pytest.mark.parametrize(
        ("needed", "profile", "expected"),
        [
            # CPU-only: usable = RAM (32 GB → good ≤16, okay ≤27.2)
            (7.5, _profile(32.0), "good"),
            (16.0, _profile(32.0), "good"),
            (16.1, _profile(32.0), "okay"),
            (27.2, _profile(32.0), "okay"),
            (28.0, _profile(32.0), "heavy"),
            # Discrete GPU: usable = VRAM, not RAM (8 GB → good ≤4, okay ≤6.8)
            (3.9, _profile(64.0, vram_gb=8.0), "good"),
            (6.0, _profile(64.0, vram_gb=8.0), "okay"),
            (7.5, _profile(64.0, vram_gb=8.0), "heavy"),
            # Unified memory: RAM is the budget even when a GPU is present
            (7.5, _profile(16.0, vram_gb=16.0, unified=True), "good"),
            (12.0, _profile(16.0, vram_gb=16.0, unified=True), "okay"),
            (15.0, _profile(16.0, vram_gb=16.0, unified=True), "heavy"),
            # Unknown capacity → heavy
            (1.0, _profile(0.0), "heavy"),
        ],
    )
    def test_ratings(self, needed: float, profile: HardwareProfile, expected: str) -> None:
        assert rate_model(needed, profile) == expected


class TestEmbedClassifier:
    @pytest.mark.parametrize(
        ("name", "expected"),
        [
            ("nomic-embed-text", True),
            ("mxbai-embed-large:latest", True),
            ("bge-m3", True),
            ("all-minilm", True),
            ("multilingual-e5-large", True),
            ("llama3.1:8b", False),
            ("qwen2.5:7b", False),
            ("mistral:7b", False),
        ],
    )
    def test_classification(self, name: str, expected: bool) -> None:
        assert is_embed_model_name(name) is expected


class TestBuiltinAgentModelPolicy:
    def test_profiles_cover_exactly_the_builtin_agents(self) -> None:
        assert set(BUILTIN_AGENT_MODEL_PROFILES) == {
            "weaver",
            "spider",
            "archivist",
            "scribe",
            "sentinel",
            "researcher",
            "standup",
        }

    @pytest.mark.parametrize(
        ("agent_id", "expected"),
        [
            ("weaver", "devstral:latest"),
            ("spider", "devstral:latest"),
            ("scribe", "mistral-small3.1:latest"),
            ("sentinel", "gpt-oss:20b"),
            ("researcher", "mistral-small3.1:latest"),
            ("standup", "mistral-small3.1:latest"),
        ],
    )
    def test_role_family_preferences(self, agent_id: str, expected: str) -> None:
        models = [
            ModelFit("devstral:latest", True, "good", 12.0),
            ModelFit("gpt-oss:20b", True, "good", 12.0),
            ModelFit("mistral-small3.1:latest", True, "good", 12.0),
        ]
        ranked = rank_models_for_builtin_agent(agent_id, models)
        assert ranked[0].name == expected

    def test_archivist_needs_no_model(self) -> None:
        models = [ModelFit("devstral:latest", True, "good", 12.0)]
        assert rank_models_for_builtin_agent("archivist", models) == []
        assert BUILTIN_AGENT_MODEL_PROFILES["archivist"].requires_model is False

    def test_hardware_fit_wins_over_role_preference(self) -> None:
        models = [
            ModelFit("gpt-oss:20b", True, "okay", 18.0),
            ModelFit("qwen2.5:7b", True, "good", 7.2),
        ]
        ranked = rank_models_for_builtin_agent("sentinel", models)
        assert [model.name for model in ranked] == ["qwen2.5:7b", "gpt-oss:20b"]

    def test_excludes_uninstalled_embedding_and_heavy_models(self) -> None:
        models = [
            ModelFit("devstral:latest", False, "good", 12.0),
            ModelFit("nomic-embed-text:latest", True, "good", 1.6),
            ModelFit("gpt-oss:20b", True, "heavy", 18.0),
            ModelFit("unknown-chat", True, "okay", 6.0),
        ]
        assert rank_models_for_builtin_agent("sentinel", models) == [models[-1]]

    def test_unknown_family_falls_back_to_largest_compatible_model(self) -> None:
        models = [
            ModelFit("acme-small", True, "good", 4.0),
            ModelFit("acme-large", True, "good", 9.0),
        ]
        ranked = rank_models_for_builtin_agent("weaver", models)
        assert ranked[0].name == "acme-large"

    def test_custom_agent_has_no_inferred_policy(self) -> None:
        models = [ModelFit("devstral:latest", True, "good", 12.0)]
        assert rank_models_for_builtin_agent("my-custom-agent", models) == []


# ---------------------------------------------------------------------------
# scan_hardware — parse paths with canned outputs
# ---------------------------------------------------------------------------

_DARWIN_OUTPUTS = {
    ("sysctl", "-n", "machdep.cpu.brand_string"): "Apple M2 Pro",
    ("sysctl", "-n", "hw.memsize"): str(32 * 1024**3),
    ("sysctl", "-n", "hw.ncpu"): "10",
    ("system_profiler", "SPDisplaysDataType", "-json"): json.dumps(
        {"SPDisplaysDataType": [{"sppci_model": "Apple M2 Pro"}]}
    ),
}

_LINUX_CPUINFO = (
    "processor\t: 0\n"
    "model name\t: AMD Ryzen 9 5950X 16-Core Processor\n"
    "processor\t: 1\n"
    "model name\t: AMD Ryzen 9 5950X 16-Core Processor\n"
)
_LINUX_MEMINFO = "MemTotal:       32617304 kB\nMemFree:          102400 kB\n"
_LINUX_NVIDIA = "NVIDIA GeForce RTX 3090, 24576 MiB"


class TestScanDarwin:
    def test_parses_canned_sysctl_output(self, monkeypatch: pytest.MonkeyPatch) -> None:
        def fake_run(cmd: list[str], notes: list[str]) -> str | None:  # noqa: ARG001
            return _DARWIN_OUTPUTS.get(tuple(cmd))

        monkeypatch.setattr(hw, "_run", fake_run)
        profile = hw._scan_darwin()

        assert profile.cpu_model == "Apple M2 Pro"
        assert profile.ram_gb == 32.0
        assert profile.cpu_cores == 10
        assert profile.gpu_name == "Apple M2 Pro"
        # Apple GPU ⇒ unified memory, no separate VRAM budget.
        assert profile.unified_memory is True
        assert profile.vram_gb is None
        assert profile.os.startswith("macOS")

    def test_all_commands_failing_still_yields_profile(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def fake_run(cmd: list[str], notes: list[str]) -> str | None:
            notes.append(f"{cmd[0]} failed")
            return None

        monkeypatch.setattr(hw, "_run", fake_run)
        profile = hw._scan_darwin()

        assert isinstance(profile, HardwareProfile)
        assert profile.ram_gb == 0.0
        assert profile.gpu_name is None
        assert profile.notes  # failures were recorded

    def test_discrete_gpu_vram_parsed(self, monkeypatch: pytest.MonkeyPatch) -> None:
        outputs = dict(_DARWIN_OUTPUTS)
        outputs[("system_profiler", "SPDisplaysDataType", "-json")] = json.dumps(
            {
                "SPDisplaysDataType": [
                    {"sppci_model": "AMD Radeon Pro 5500M", "spdisplays_vram": "8 GB"}
                ]
            }
        )

        def fake_run(cmd: list[str], notes: list[str]) -> str | None:  # noqa: ARG001
            return outputs.get(tuple(cmd))

        monkeypatch.setattr(hw, "_run", fake_run)
        profile = hw._scan_darwin()

        assert profile.gpu_name == "AMD Radeon Pro 5500M"
        assert profile.vram_gb == 8.0


class TestScanLinux:
    def test_parses_canned_proc_and_nvidia(self, monkeypatch: pytest.MonkeyPatch) -> None:
        files = {
            Path("/proc/cpuinfo"): _LINUX_CPUINFO,
            Path("/proc/meminfo"): _LINUX_MEMINFO,
        }

        def fake_read(path: Path, notes: list[str]) -> str | None:  # noqa: ARG001
            return files.get(path)

        def fake_run(cmd: list[str], notes: list[str]) -> str | None:  # noqa: ARG001
            if cmd[0] == "nvidia-smi":
                return _LINUX_NVIDIA
            return None

        monkeypatch.setattr(hw, "_read", fake_read)
        monkeypatch.setattr(hw, "_run", fake_run)
        profile = hw._scan_linux()

        assert profile.cpu_model == "AMD Ryzen 9 5950X 16-Core Processor"
        assert profile.cpu_cores == 2
        assert profile.ram_gb == 31.1
        assert profile.gpu_name == "NVIDIA GeForce RTX 3090"
        assert profile.vram_gb == 24.0
        assert profile.unified_memory is False

    def test_missing_proc_and_gpu_still_yields_profile(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def fake_read(path: Path, notes: list[str]) -> str | None:
            notes.append(f"{path} unreadable")
            return None

        def fake_run(cmd: list[str], notes: list[str]) -> str | None:
            notes.append(f"{cmd[0]} unavailable")
            return None

        monkeypatch.setattr(hw, "_read", fake_read)
        monkeypatch.setattr(hw, "_run", fake_run)
        profile = hw._scan_linux()

        assert isinstance(profile, HardwareProfile)
        assert profile.ram_gb == 0.0
        assert profile.gpu_name is None
        assert profile.cpu_cores > 0  # os.cpu_count() fallback
        assert profile.notes


class TestScanNeverRaises:
    def test_subprocess_explosion_is_contained(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Even a raising _run/_read must not escape scan_hardware."""

        def boom(*args: object, **kwargs: object) -> str:
            raise RuntimeError("kaboom")

        monkeypatch.setattr(hw, "_run", boom)
        monkeypatch.setattr(hw, "_read", boom)
        profile = scan_hardware()

        assert isinstance(profile, HardwareProfile)
        assert profile.scanned_at

    def test_run_helper_swallows_oserror(self, monkeypatch: pytest.MonkeyPatch) -> None:
        def raising_run(*args: object, **kwargs: object) -> object:
            raise OSError("no such binary")

        monkeypatch.setattr(hw.subprocess, "run", raising_run)
        notes: list[str] = []
        assert hw._run(["sysctl", "-n", "hw.ncpu"], notes) is None
        assert notes and "sysctl" in notes[0]

    def test_plain_scan_returns_profile(self) -> None:
        profile = scan_hardware()
        assert isinstance(profile, HardwareProfile)
        assert profile.os
        assert profile.cpu_cores >= 0
