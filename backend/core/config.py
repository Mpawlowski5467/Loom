"""Loom configuration models.

Two layers:

* :class:`LoomSettings` — environment-driven app settings (env vars, ``LOOM_*``).
* :class:`GlobalConfig` — YAML-persisted state at ``~/.loom/config.yaml``
  (providers, active vault, UI prefs, onboarding gate).

API keys live on ``ProviderConfig.api_key`` and are persisted in plain text
under ``~/.loom/config.yaml`` (file permissions are the only protection).
``GlobalConfig.public()`` returns a redacted view safe for the frontend.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Self

import yaml
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings


class LoomSettings(BaseSettings):
    """Environment-driven app configuration."""

    loom_home: Path = Field(
        default=Path.home() / ".loom",
        description="Root directory for all Loom data",
    )
    active_vault: str = Field(
        default="default",
        description="Name of the currently active vault",
    )
    default_provider: str = Field(
        default="openai",
        description="Default LLM provider",
    )
    cors_origins: list[str] = Field(
        default=["http://localhost:5173"],
        description=(
            "Allowed CORS origins for the API. Override via LOOM_CORS_ORIGINS "
            '(JSON list, e.g. \'["http://localhost:5173","http://localhost:4173"]\').'
        ),
    )

    @property
    def vaults_dir(self) -> Path:
        """Path to the vaults directory."""
        return self.loom_home / "vaults"

    @property
    def active_vault_dir(self) -> Path:
        """Path to the currently active vault."""
        return self.vaults_dir / self.active_vault

    @property
    def config_path(self) -> Path:
        """Path to the global config.yaml."""
        return self.loom_home / "config.yaml"

    model_config = {"env_prefix": "LOOM_"}


settings = LoomSettings()


# -- Persisted YAML config models ---------------------------------------------


class ThemeName(StrEnum):
    """Themes shipped with Loom. Paper is the default."""

    paper = "paper"
    navy = "navy"
    forest = "forest"
    sepia = "sepia"
    slate = "slate"
    carbon = "carbon"
    iris = "iris"
    lagoon = "lagoon"


class ProviderConfig(BaseModel):
    """Configuration for a single LLM provider."""

    api_key: str | None = None
    chat_model: str = "gpt-4o"
    embed_model: str | None = None
    host: str | None = None

    def to_public(self) -> ProviderConfigPublic:
        """Return a redacted view safe for the API."""
        return ProviderConfigPublic(
            api_key_set=bool(self.api_key),
            chat_model=self.chat_model,
            embed_model=self.embed_model or "",
            host=self.host or "",
        )


class ProviderConfigPublic(BaseModel):
    """Provider config without the api_key — for outbound API responses."""

    api_key_set: bool
    chat_model: str = ""
    embed_model: str = ""
    host: str = ""


class RateLimitConfig(BaseModel):
    """Rate limit settings, configurable in config.yaml."""

    read: str = "120/minute"
    write: str = "30/minute"


class UIState(BaseModel):
    """Persisted UI preferences."""

    theme: ThemeName = ThemeName.paper


class OnboardingState(BaseModel):
    """Server-side onboarding gate.

    ``completed`` is the single source of truth that gates the wizard.
    """

    completed: bool = False
    completed_at: datetime | None = None
    steps_done: list[str] = Field(default_factory=list)


class GlobalConfig(BaseModel):
    """Maps to ~/.loom/config.yaml."""

    active_vault: str = "default"
    default_provider: str = "openai"
    providers: dict[str, ProviderConfig] = {}
    embed_provider: str | None = None
    chat_provider: str | None = None
    rate_limit: RateLimitConfig = Field(default_factory=RateLimitConfig)
    ui: UIState = Field(default_factory=UIState)
    onboarding: OnboardingState = Field(default_factory=OnboardingState)

    @classmethod
    def load(cls, path: Path) -> Self:
        """Load from a YAML file, returning defaults if the file is missing."""
        if not path.exists():
            return cls()
        data = yaml.safe_load(path.read_text()) or {}
        return cls.model_validate(data)

    def save(self, path: Path) -> None:
        """Write to a YAML file, creating parent directories as needed."""
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_suffix(f"{path.suffix}.tmp")
        tmp_path.write_text(
            yaml.safe_dump(
                self.model_dump(exclude_none=True, mode="json"),
                default_flow_style=False,
                sort_keys=False,
            ),
        )
        tmp_path.replace(path)

    def to_public(self) -> GlobalConfigPublic:
        """Return a serialization-safe view (api keys redacted)."""
        return GlobalConfigPublic(
            active_vault=self.active_vault,
            default_provider=self.default_provider,
            providers={name: cfg.to_public() for name, cfg in self.providers.items()},
            ui=self.ui,
            onboarding=self.onboarding,
        )


class GlobalConfigPublic(BaseModel):
    """Serializable, redacted view of GlobalConfig."""

    active_vault: str
    default_provider: str
    providers: dict[str, ProviderConfigPublic]
    ui: UIState
    onboarding: OnboardingState


class VaultConfig(BaseModel):
    """Maps to a vault's vault.yaml."""

    name: str
    custom_folders: list[str] = []
    auto_git: bool = False
    memory_summarize_cadence: int = Field(
        default=20,
        description="Number of agent actions between memory summarizations",
    )

    @classmethod
    def load(cls, path: Path) -> Self:
        """Load from a YAML file, returning defaults if the file is missing."""
        if not path.exists():
            return cls(name="default")
        data = yaml.safe_load(path.read_text()) or {}
        return cls.model_validate(data)

    def save(self, path: Path) -> None:
        """Write to a YAML file, creating parent directories as needed."""
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            yaml.safe_dump(
                self.model_dump(),
                default_flow_style=False,
                sort_keys=False,
            )
        )
