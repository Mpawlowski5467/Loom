"""Loom configuration models.

Plain-text storage at ``~/.loom/config.yaml``. API keys are kept on disk in
plain text — file permissions (``0600``, set by ``config_io``) are the only
protection. ``ProviderConfig.api_key`` uses ``Field(repr=False)`` so it never
appears in logs or tracebacks; the public-facing variant exposes only
``api_key_set: bool``.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field


class ThemeName(StrEnum):
    """Themes shipped with Loom. Paper is the default."""

    paper = "paper"
    navy = "navy"
    forest = "forest"
    sepia = "sepia"


class ProviderConfig(BaseModel):
    """Configuration for a single AI provider.

    ``api_key`` is excluded from ``repr`` so it never leaks into logs. Do not
    serialize this model to the frontend — convert with :meth:`to_public`.
    """

    model_config = ConfigDict(extra="forbid")

    api_key: str = Field(default="", repr=False)
    chat_model: str = ""
    embed_model: str = ""
    host: str = ""

    def to_public(self) -> ProviderConfigPublic:
        """Return a redacted view safe for the API."""
        return ProviderConfigPublic(
            api_key_set=bool(self.api_key),
            chat_model=self.chat_model,
            embed_model=self.embed_model,
            host=self.host,
        )


class ProviderConfigPublic(BaseModel):
    """Provider config without the api_key — for outbound API responses."""

    model_config = ConfigDict(extra="forbid")

    api_key_set: bool
    chat_model: str = ""
    embed_model: str = ""
    host: str = ""


class UIState(BaseModel):
    """Persisted UI preferences."""

    model_config = ConfigDict(extra="forbid")

    theme: ThemeName = ThemeName.paper


class OnboardingState(BaseModel):
    """Server-side onboarding gate.

    ``completed`` is the single source of truth that gates the wizard.
    """

    model_config = ConfigDict(extra="forbid")

    completed: bool = False
    completed_at: datetime | None = None
    steps_done: list[str] = Field(default_factory=list)


class LoomConfig(BaseModel):
    """Global Loom configuration (``~/.loom/config.yaml``)."""

    model_config = ConfigDict(extra="forbid")

    loom_dir: Path = Field(default_factory=lambda: Path.home() / ".loom")
    active_vault: str = "default"
    default_provider: str = "openai"
    providers: dict[str, ProviderConfig] = Field(default_factory=dict)
    ui: UIState = Field(default_factory=UIState)
    onboarding: OnboardingState = Field(default_factory=OnboardingState)

    @property
    def vault_path(self) -> Path:
        """Path to the active vault."""
        return self.loom_dir / "vaults" / self.active_vault

    @property
    def config_path(self) -> Path:
        """Path to the on-disk config file."""
        return self.loom_dir / "config.yaml"

    def to_public(self) -> LoomConfigPublic:
        """Return a serialization-safe view (api keys redacted)."""
        return LoomConfigPublic(
            loom_dir=str(self.loom_dir),
            active_vault=self.active_vault,
            default_provider=self.default_provider,
            providers={name: cfg.to_public() for name, cfg in self.providers.items()},
            ui=self.ui,
            onboarding=self.onboarding,
        )


class LoomConfigPublic(BaseModel):
    """Serializable, redacted view of LoomConfig."""

    model_config = ConfigDict(extra="forbid")

    loom_dir: str
    active_vault: str
    default_provider: str
    providers: dict[str, ProviderConfigPublic]
    ui: UIState
    onboarding: OnboardingState
