from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings


class LoomSettings(BaseSettings):
    """Global Loom configuration."""

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

    @property
    def vaults_dir(self) -> Path:
        """Path to the vaults directory."""
        return self.loom_home / "vaults"

    @property
    def active_vault_dir(self) -> Path:
        """Path to the currently active vault."""
        return self.vaults_dir / self.active_vault

    model_config = {"env_prefix": "LOOM_"}


settings = LoomSettings()
