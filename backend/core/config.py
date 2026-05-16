from pathlib import Path

from pydantic import BaseModel, Field


class ProviderConfig(BaseModel):
    """Configuration for a single AI provider."""

    api_key: str = ""
    chat_model: str = ""
    embed_model: str = ""
    host: str = ""


class LoomConfig(BaseModel):
    """Global Loom configuration."""

    loom_dir: Path = Field(default=Path.home() / ".loom")
    active_vault: str = "default"
    default_provider: str = "openai"
    providers: dict[str, ProviderConfig] = Field(default_factory=dict)

    @property
    def vault_path(self) -> Path:
        """Path to the active vault."""
        return self.loom_dir / "vaults" / self.active_vault
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
            "(JSON list, e.g. '[\"http://localhost:5173\",\"http://localhost:4173\"]')."
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


class ProviderConfig(BaseModel):
    """Configuration for a single LLM provider."""

    api_key: str | None = None
    chat_model: str = "gpt-4o"
    embed_model: str | None = None
    host: str | None = None


class RateLimitConfig(BaseModel):
    """Rate limit settings, configurable in config.yaml."""

    read: str = "120/minute"
    write: str = "30/minute"


class GlobalConfig(BaseModel):
    """Maps to ~/.loom/config.yaml."""

    active_vault: str = "default"
    providers: dict[str, ProviderConfig] = {}
    embed_provider: str | None = None
    chat_provider: str | None = None
    rate_limit: RateLimitConfig = Field(default_factory=RateLimitConfig)

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
        path.write_text(
            yaml.safe_dump(
                self.model_dump(exclude_none=True),
                default_flow_style=False,
                sort_keys=False,
            )
        )


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
