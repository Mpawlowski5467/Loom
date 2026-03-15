"""Custom exceptions for Loom."""


class LoomError(Exception):
    """Base exception for all Loom errors."""


class VaultExistsError(LoomError):
    """Raised when attempting to create a vault that already exists."""

    def __init__(self, name: str) -> None:
        super().__init__(f"Vault '{name}' already exists")
        self.name = name


class VaultNotFoundError(LoomError):
    """Raised when a vault cannot be found."""

    def __init__(self, name: str) -> None:
        super().__init__(f"Vault '{name}' not found")
        self.name = name


class InvalidVaultNameError(LoomError):
    """Raised when a vault name is invalid."""

    def __init__(self, name: str) -> None:
        super().__init__(
            f"Invalid vault name '{name}'. "
            "Must be 1-64 characters, alphanumeric, hyphens, or underscores."
        )
        self.name = name


class NoteNotFoundError(LoomError):
    """Raised when a note cannot be found."""

    def __init__(self, note_id: str) -> None:
        super().__init__(f"Note '{note_id}' not found")
        self.note_id = note_id


class ProviderConfigError(LoomError):
    """Raised when provider configuration is missing or invalid."""

    def __init__(self, message: str) -> None:
        super().__init__(message)


class ProviderError(LoomError):
    """Raised when a provider call fails."""

    def __init__(self, provider: str, message: str) -> None:
        super().__init__(f"[{provider}] {message}")
        self.provider = provider
