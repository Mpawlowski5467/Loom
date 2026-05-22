"""Custom exceptions for Loom."""

from __future__ import annotations


class LoomError(Exception):
    """Base class for all Loom-raised errors."""

    status_code: int = 500


class ConfigError(LoomError):
    """Raised when loading or saving config fails."""

    status_code = 500


class VaultError(LoomError):
    """Base for vault-related errors."""

    status_code = 400


class VaultExistsError(VaultError):
    """Raised when attempting to create a vault that already exists."""

    status_code = 409

    def __init__(self, name: str, scaffolded: bool) -> None:
        super().__init__(f"Vault '{name}' already exists (scaffolded={scaffolded}).")
        self.name = name
        self.scaffolded = scaffolded


class UnknownProviderError(LoomError):
    """Raised when a provider name is not registered."""

    status_code = 404

    def __init__(self, name: str) -> None:
        super().__init__(f"Unknown provider: {name}")
        self.name = name


class ProviderError(LoomError):
    """Raised when a provider request fails (auth, network, unknown)."""

    status_code = 502

    def __init__(self, provider: str, kind: str, message: str) -> None:
        super().__init__(f"[{provider}] {kind}: {message}")
        self.provider = provider
        self.kind = kind
        self.message = message
