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
