"""Deterministic local-model fit advisor.

Pure functions that estimate how much memory a model needs and rate that
against a :class:`~core.hardware.HardwareProfile`. No I/O — the callers
(the hardware router) supply Ollama metadata and hardware profiles.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from core.hardware import HardwareProfile

Rating = Literal["good", "okay", "heavy"]

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
