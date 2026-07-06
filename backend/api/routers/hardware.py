"""``/api/hardware`` — hardware scan, saved profile, and model recommendations."""

from __future__ import annotations

import asyncio
import contextlib
import time
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from api.routers.providers import _KNOWN, fetch_ollama_tags, ollama_host
from api.routers.settings_helpers import build_provider_from_input, provider_input_from_saved
from core.config import GlobalConfig, settings
from core.exceptions import ProviderConfigError
from core.hardware import HardwareProfile, scan_hardware
from core.model_advisor import (
    CURATED_OLLAMA_MODELS,
    Rating,
    estimate_model_ram_gb,
    is_embed_model_name,
    rate_model,
)

router = APIRouter(prefix="/api/hardware", tags=["hardware"])

_BENCHMARK_TIMEOUT_S = 60.0
_BENCHMARK_PROMPT = "Reply with exactly: ready"


class HardwareResponse(BaseModel):
    """A fresh scan plus whatever profile was last saved (if any)."""

    profile: HardwareProfile
    saved: HardwareProfile | None = None


class SaveHardwareRequest(BaseModel):
    """Optional explicit profile; omitted → persist a fresh scan."""

    profile: HardwareProfile | None = None


class SaveHardwareResponse(BaseModel):
    saved: HardwareProfile


class ModelRecommendation(BaseModel):
    """One local model rated against the hardware profile."""

    name: str
    installed: bool
    est_ram_gb: float
    rating: Rating
    recommended_for: list[str] = Field(default_factory=list)
    size_bytes: int | None = None


class RecommendationsResponse(BaseModel):
    profile: HardwareProfile
    models: list[ModelRecommendation]


class BenchmarkRequest(BaseModel):
    provider: str
    model: str


class BenchmarkResponse(BaseModel):
    """Benchmark outcome; errors are inline, never HTTP errors."""

    ok: bool
    latency_ms: int = 0
    chars: int = 0
    chars_per_sec: float = 0.0
    error: str | None = None


@router.get("", response_model=HardwareResponse)
async def get_hardware() -> HardwareResponse:
    """Return a fresh hardware scan alongside the saved profile."""
    cfg = GlobalConfig.load(settings.config_path)
    # scan_hardware shells out (system_profiler alone can take seconds) —
    # keep it off the event loop so concurrent requests/streams don't stall.
    return HardwareResponse(profile=await asyncio.to_thread(scan_hardware), saved=cfg.hardware)


@router.post("/save", response_model=SaveHardwareResponse)
async def save_hardware(body: SaveHardwareRequest | None = None) -> SaveHardwareResponse:
    """Persist a hardware profile (a fresh scan when none is supplied)."""
    profile = body.profile if body else None
    if profile is None:
        profile = await asyncio.to_thread(scan_hardware)
    cfg = GlobalConfig.load(settings.config_path)
    cfg.hardware = profile
    cfg.save(settings.config_path)
    return SaveHardwareResponse(saved=profile)


@router.get("/recommendations", response_model=RecommendationsResponse)
async def get_recommendations() -> RecommendationsResponse:
    """Rate installed + curated Ollama models against the hardware profile."""
    cfg = GlobalConfig.load(settings.config_path)
    profile = cfg.hardware
    if profile is None:
        profile = await asyncio.to_thread(scan_hardware)
    try:
        installed = await fetch_ollama_tags(ollama_host(cfg))
    except Exception:  # noqa: BLE001 — no Ollama is fine; curated list still helps
        installed = []
    return RecommendationsResponse(
        profile=profile,
        models=_build_recommendations(profile, installed),
    )


@router.post("/benchmark", response_model=BenchmarkResponse)
async def benchmark_model(body: BenchmarkRequest) -> BenchmarkResponse:
    """Time one short chat against an unregistered provider/model pair.

    Builds the provider directly (bypassing the registry, like the test
    endpoints) so any model can be probed without touching saved settings.
    """
    if body.provider not in _KNOWN:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Unknown provider: {body.provider}")
    cfg = GlobalConfig.load(settings.config_path)
    runtime = provider_input_from_saved(
        body.provider, cfg.providers.get(body.provider), chat_model=body.model
    )

    start = time.perf_counter()
    try:
        provider = build_provider_from_input(runtime)
    except ProviderConfigError as exc:
        return BenchmarkResponse(ok=False, error=str(exc))

    def _elapsed_ms() -> int:
        return int((time.perf_counter() - start) * 1000)

    try:
        text = await asyncio.wait_for(
            provider.chat([{"role": "user", "content": _BENCHMARK_PROMPT}]),
            timeout=_BENCHMARK_TIMEOUT_S,
        )
        latency_ms = _elapsed_ms()
        chars = len(text)
        return BenchmarkResponse(
            ok=True,
            latency_ms=latency_ms,
            chars=chars,
            chars_per_sec=round(chars / max(latency_ms / 1000.0, 0.001), 1),
        )
    except TimeoutError:
        return BenchmarkResponse(
            ok=False,
            latency_ms=_elapsed_ms(),
            error=f"Timed out after {int(_BENCHMARK_TIMEOUT_S)}s",
        )
    except Exception as exc:  # noqa: BLE001 — surface any provider error inline
        return BenchmarkResponse(ok=False, latency_ms=_elapsed_ms(), error=str(exc))
    finally:
        if hasattr(provider, "close"):
            with contextlib.suppress(Exception):
                await provider.close()


# -- Recommendation assembly ----------------------------------------------------


def _normalize_name(name: str) -> str:
    """Treat ``model:latest`` and ``model`` as the same model."""
    return name.removesuffix(":latest")


def _build_recommendations(
    profile: HardwareProfile,
    installed: list[dict[str, Any]],
) -> list[ModelRecommendation]:
    """Union of installed Ollama models and the curated pullable shortlist."""
    models: list[ModelRecommendation] = []
    seen: set[str] = set()

    for raw in installed:
        name = str(raw.get("name") or raw.get("model") or "")
        if not name:
            continue
        size = raw.get("size")
        size_bytes = size if isinstance(size, int) else None
        details = raw.get("details")
        param_size = details.get("parameter_size") if isinstance(details, dict) else None
        est = estimate_model_ram_gb(name, size_bytes, str(param_size) if param_size else None)
        models.append(
            ModelRecommendation(
                name=name,
                installed=True,
                est_ram_gb=est,
                rating=rate_model(est, profile),
                size_bytes=size_bytes,
            )
        )
        seen.add(_normalize_name(name))

    for name, param_size in CURATED_OLLAMA_MODELS:
        if _normalize_name(name) in seen:
            continue
        est = estimate_model_ram_gb(name, None, param_size)
        models.append(
            ModelRecommendation(
                name=name,
                installed=False,
                est_ram_gb=est,
                rating=rate_model(est, profile),
            )
        )

    _mark_recommended(models)
    return models


def _mark_recommended(models: list[ModelRecommendation]) -> None:
    """Tag the best good-rated chat and embed models.

    "Best" = installed first, then the largest estimate that still rates
    ``good`` (bigger models that fit comfortably tend to be stronger); name
    as the deterministic tiebreak.
    """

    def _best(*, embed: bool) -> ModelRecommendation | None:
        candidates = [
            m for m in models if m.rating == "good" and is_embed_model_name(m.name) == embed
        ]
        candidates.sort(key=lambda m: (not m.installed, -m.est_ram_gb, m.name))
        return candidates[0] if candidates else None

    best_chat = _best(embed=False)
    if best_chat is not None:
        best_chat.recommended_for = ["chat"]
    best_embed = _best(embed=True)
    if best_embed is not None:
        best_embed.recommended_for = ["embed"]
