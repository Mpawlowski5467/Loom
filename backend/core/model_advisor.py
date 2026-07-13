"""Deterministic local-model fit advisor.

Pure functions that estimate how much memory a model needs and rate that
against a :class:`~core.hardware.HardwareProfile`. No I/O — the callers
(the hardware router) supply Ollama metadata and hardware profiles.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from core.hardware import HardwareProfile

Rating = Literal["good", "okay", "heavy"]


@dataclass(frozen=True)
class ModelFit:
    """Minimal model facts used by the role-aware ranking policy."""

    name: str
    installed: bool
    rating: Rating
    est_ram_gb: float


@dataclass(frozen=True)
class BuiltinAgentModelProfile:
    """Local-model preferences for one built-in Loom agent."""

    name: str
    role: str
    family_preferences: tuple[str, ...]
    recommendation_reason: str
    requires_model: bool = True


# Ollama reports parameter counts like "7.6B" or "137M".
_PARAM_SIZE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*([MB])", re.IGNORECASE)
# Model names commonly embed the size: "llama3.1:8b", "qwen2.5:14b".
_NAME_PARAM_RE = re.compile(r"(\d+(?:\.\d+)?)b\b", re.IGNORECASE)

# ~Q4 quantization: roughly 0.75 GB per billion params, plus runtime overhead
# (KV cache, context buffers).
_GB_PER_BILLION_PARAMS = 0.75
_RUNTIME_OVERHEAD_GB = 1.5
# A model needs somewhat more RAM than its on-disk size once loaded.
_DISK_TO_RAM_FACTOR = 1.2
_DEFAULT_ESTIMATE_GB = 4.0

_EMBED_NAME_MARKERS = ("embed", "bge", "minilm", "e5")

# These profiles are intentionally limited to Loom's built-in agents. Custom
# agents have user-defined jobs, so Loom cannot infer a reliable role policy;
# their provider/model remains an explicit user choice in the agent editor.
BUILTIN_AGENT_MODEL_PROFILES: dict[str, BuiltinAgentModelProfile] = {
    "weaver": BuiltinAgentModelProfile(
        name="weaver",
        role="creates notes from captures",
        family_preferences=("devstral", "gpt-oss", "qwen", "llama", "mistral", "gemma", "phi"),
        recommendation_reason="Prioritizes instruction following and structured note creation.",
    ),
    "spider": BuiltinAgentModelProfile(
        name="spider",
        role="auto-links across the vault",
        family_preferences=("devstral", "qwen", "mistral", "llama", "gpt-oss", "gemma", "phi"),
        recommendation_reason="Prioritizes structured relationship extraction and classification.",
    ),
    "archivist": BuiltinAgentModelProfile(
        name="archivist",
        role="folder hygiene & cleanup",
        family_preferences=(),
        recommendation_reason="Archivist currently uses deterministic vault checks; no model required.",
        requires_model=False,
    ),
    "scribe": BuiltinAgentModelProfile(
        name="scribe",
        role="generates summaries",
        family_preferences=(
            "mistral-small",
            "qwen",
            "llama",
            "mistral",
            "gemma",
            "devstral",
            "phi",
        ),
        recommendation_reason="Prioritizes concise summarization and natural prose.",
    ),
    "sentinel": BuiltinAgentModelProfile(
        name="sentinel",
        role="validates edits before commit",
        family_preferences=("gpt-oss", "devstral", "qwen", "llama", "mistral", "gemma", "phi"),
        recommendation_reason="Prioritizes strict reasoning and machine-readable validation.",
    ),
    "researcher": BuiltinAgentModelProfile(
        name="researcher",
        role="queries the web and synthesizes",
        family_preferences=(
            "mistral-small",
            "deepseek-r1",
            "qwen",
            "llama",
            "gemma",
            "devstral",
            "phi",
        ),
        recommendation_reason="Prioritizes synthesis, grounded writing, and long-context reasoning.",
    ),
    "standup": BuiltinAgentModelProfile(
        name="standup",
        role="daily recap & planning",
        family_preferences=(
            "mistral-small",
            "qwen",
            "llama",
            "mistral",
            "gemma",
            "devstral",
            "phi",
        ),
        recommendation_reason="Prioritizes concise summaries and practical planning.",
    ),
}

#: Popular pullable Ollama models with their known parameter counts, used to
#: seed recommendations beyond what is already installed.
CURATED_OLLAMA_MODELS: tuple[tuple[str, str], ...] = (
    ("llama3.1:8b", "8.0B"),
    ("qwen2.5:7b", "7.6B"),
    ("qwen2.5:14b", "14.8B"),
    ("mistral:7b", "7.2B"),
    ("phi3", "3.8B"),
    ("gemma2:9b", "9.2B"),
    ("nomic-embed-text", "137M"),
    ("mxbai-embed-large", "334M"),
)


def is_embed_model_name(name: str) -> bool:
    """Whether a model name looks like an embedding model."""
    lowered = name.lower()
    return any(marker in lowered for marker in _EMBED_NAME_MARKERS)


def rank_models_for_builtin_agent(agent_id: str, models: list[ModelFit]) -> list[ModelFit]:
    """Rank installed, runnable chat models for one built-in agent.

    Hardware fit is the first sort key so a role-specific family never wins at
    the cost of an overloaded machine. Within the same fit tier, known model
    families are ordered by the agent's task profile. Unknown families remain
    useful fallbacks and are ranked by estimated capacity.

    Custom/unknown agent IDs deliberately return no results.
    """
    profile = BUILTIN_AGENT_MODEL_PROFILES.get(agent_id)
    if profile is None or not profile.requires_model:
        return []

    eligible = [
        model
        for model in models
        if model.installed
        and model.rating in {"good", "okay"}
        and not is_embed_model_name(model.name)
    ]
    rating_rank = {"good": 0, "okay": 1}

    def _family_rank(name: str) -> int:
        lowered = name.lower()
        for index, marker in enumerate(profile.family_preferences):
            if marker in lowered:
                return index
        return len(profile.family_preferences)

    eligible.sort(
        key=lambda model: (
            rating_rank[model.rating],
            _family_rank(model.name),
            -model.est_ram_gb,
            model.name,
        )
    )
    return eligible


def _params_billions(name: str, parameter_size: str | None) -> float | None:
    """Parse a parameter count (in billions) from metadata or the model name."""
    if parameter_size:
        match = _PARAM_SIZE_RE.search(parameter_size)
        if match is not None:
            value = float(match.group(1))
            return value / 1000 if match.group(2).upper() == "M" else value
    match = _NAME_PARAM_RE.search(name)
    if match is not None:
        return float(match.group(1))
    return None


def estimate_model_ram_gb(
    name: str,
    size_bytes: int | None,
    parameter_size: str | None,
) -> float:
    """Estimate the RAM (GB) a model needs to run, assuming ~Q4 quantization.

    Prefers the parameter count (from Ollama metadata like ``"7.6B"``, else a
    size suffix in the name like ``"llama3.1:8b"``); falls back to scaling the
    on-disk size; falls back to a conservative default.
    """
    params = _params_billions(name, parameter_size)
    if params is not None:
        return round(params * _GB_PER_BILLION_PARAMS + _RUNTIME_OVERHEAD_GB, 1)
    if size_bytes:
        return round(size_bytes / 1024**3 * _DISK_TO_RAM_FACTOR, 1)
    return _DEFAULT_ESTIMATE_GB


def rate_model(needed_gb: float, profile: HardwareProfile) -> Rating:
    """Rate a model's memory need against the machine's usable memory.

    Usable memory is dedicated VRAM when present (discrete GPU); on unified
    memory (Apple Silicon) or CPU-only machines it's system RAM.
    """
    usable = profile.vram_gb if profile.vram_gb and not profile.unified_memory else profile.ram_gb
    if usable <= 0:
        return "heavy"
    if needed_gb <= 0.5 * usable:
        return "good"
    if needed_gb <= 0.85 * usable:
        return "okay"
    return "heavy"
