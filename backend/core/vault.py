"""Vault management: initialization, listing, and active-vault switching."""

import re
from pathlib import Path

from core.config import GlobalConfig, LoomSettings, VaultConfig, settings
from core.defaults import (
    AGENT_MEMORY_MD,
    AGENT_STATE_JSON,
    ALL_AGENTS,
    COMPILER_YAML,
    LOOM_AGENTS,
    POLICIES,
    PRIME_MD,
    SCHEMAS,
    SHUTTLE_AGENTS,
    SYSTEM_PREAMBLE_MD,
    WORKFLOWS,
    agent_config_yaml,
)
from core.exceptions import (
    InvalidVaultNameError,
    LoomError,
    VaultExistsError,
    VaultNotFoundError,
)

CORE_FOLDERS = ["daily", "projects", "topics", "people", "captures", ".archive"]

AGENT_NAMES = frozenset(
    {
        "weaver",
        "spider",
        "archivist",
        "scribe",
        "sentinel",
        "researcher",
        "standup",
        "_council",
    }
)

_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class VaultPathError(LoomError):
    """Raised when a user-supplied path component is invalid or escapes the vault."""


class VaultManager:
    """Handles vault creation, listing, and active-vault management."""

    def __init__(self, settings: LoomSettings | None = None) -> None:
        self._settings = settings or globals()["settings"]

    # -- Public API -----------------------------------------------------------

    def init_vault(self, name: str) -> Path:
        """Create a new vault with the full default structure."""
        self._validate_name(name)
        root = self._vault_root(name)

        if self.vault_exists(name):
            raise VaultExistsError(name)

        root.mkdir(parents=True)
        self._create_threads(root)
        self._create_agents(root)
        self._create_rules(root)
        self._create_prompts(root)
        self._create_loom_meta(root)

        VaultConfig(name=name).save(root / "vault.yaml")

        # Set as active if this is the first vault
        if not self.list_vaults() or len(self.list_vaults()) == 1:
            config = GlobalConfig.load(self._settings.config_path)
            config.active_vault = name
            config.save(self._settings.config_path)

        return root

    def list_vaults(self) -> list[str]:
        """Return names of all initialized vaults."""
        vaults_dir = self._settings.vaults_dir
        if not vaults_dir.exists():
            return []
        return sorted(
            d.name for d in vaults_dir.iterdir() if d.is_dir() and (d / "vault.yaml").exists()
        )

    def get_active_vault(self) -> str:
        """Return the name of the currently active vault."""
        config = GlobalConfig.load(self._settings.config_path)
        return config.active_vault

    def set_active_vault(self, name: str) -> None:
        """Switch the active vault."""
        if not self.vault_exists(name):
            raise VaultNotFoundError(name)
        config = GlobalConfig.load(self._settings.config_path)
        config.active_vault = name
        config.save(self._settings.config_path)

    def vault_exists(self, name: str) -> bool:
        """Check whether a vault with the given name exists."""
        return (self._vault_root(name) / "vault.yaml").exists()

    def active_vault_dir(self) -> Path:
        """Return the root path of the currently active vault."""
        return self._vault_root(self.get_active_vault())

    def active_threads_dir(self) -> Path:
        """Return the threads/ directory of the active vault."""
        return self.active_vault_dir() / "threads"

    def active_loom_dir(self) -> Path:
        """Return the .loom/ directory of the active vault."""
        return self.active_vault_dir() / ".loom"

    def vault_path(self, name: str) -> Path:
        """Return the root path for a vault by name."""
        return self._settings.vaults_dir / name

    # -- Path validation / safe construction ----------------------------------

    @staticmethod
    def validate_agent_name(name: str) -> str:
        """Return ``name`` if it is a known agent identifier, else raise."""
        if name not in AGENT_NAMES:
            raise VaultPathError(f"Unknown agent: {name!r}")
        return name

    @staticmethod
    def validate_date(date_str: str) -> str:
        """Return ``date_str`` if it matches ``YYYY-MM-DD``, else raise."""
        if not _DATE_RE.match(date_str):
            raise VaultPathError(f"Invalid date: {date_str!r}")
        return date_str

    def changelog_path(self, agent: str, date_str: str) -> Path:
        """Return the changelog path for an agent on a date, validated."""
        agent = self.validate_agent_name(agent)
        date_str = self.validate_date(date_str)
        return self.active_loom_dir() / "changelog" / agent / f"{date_str}.md"

    def chat_path(self, agent: str, date_str: str) -> Path:
        """Return the chat-history path for an agent on a date, validated."""
        agent = self.validate_agent_name(agent)
        date_str = self.validate_date(date_str)
        return self.active_vault_dir() / "agents" / agent / "chat" / f"{date_str}.md"

    def resolve_capture_path(self, user_path: str) -> Path:
        """Resolve a user-supplied capture path, refusing anything outside the vault.

        Accepts a relative path under ``threads/`` or an absolute path.  The result
        is canonicalized (symlinks resolved) and asserted to live inside the active
        threads directory and end in ``.md``.
        """
        if not user_path:
            raise VaultPathError("Capture path is empty")

        threads_dir = self.active_threads_dir().resolve()
        candidate = Path(user_path)
        if not candidate.is_absolute():
            candidate = threads_dir / candidate

        try:
            resolved = candidate.resolve()
        except OSError as exc:
            raise VaultPathError(f"Cannot resolve capture path: {exc}") from exc

        if resolved.suffix != ".md":
            raise VaultPathError("Capture path must end in .md")

        try:
            resolved.relative_to(threads_dir)
        except ValueError as exc:
            raise VaultPathError("Capture path escapes the vault") from exc

        return resolved

    # -- Private helpers ------------------------------------------------------

    def _vault_root(self, name: str) -> Path:
        return self._settings.vaults_dir / name

    def _validate_name(self, name: str) -> None:
        if not _NAME_RE.match(name):
            raise InvalidVaultNameError(name)

    def _create_threads(self, root: Path) -> None:
        for folder in CORE_FOLDERS:
            (root / "threads" / folder).mkdir(parents=True)

    def _create_agents(self, root: Path) -> None:
        for agent in LOOM_AGENTS:
            self._create_agent_dir(root / "agents" / agent, agent, has_chat=False)
        for agent in SHUTTLE_AGENTS:
            self._create_agent_dir(root / "agents" / agent, agent, has_chat=True)
        (root / "agents" / "_council" / "chat").mkdir(parents=True)

    def _create_agent_dir(self, agent_dir: Path, name: str, *, has_chat: bool) -> None:
        agent_dir.mkdir(parents=True)
        (agent_dir / "config.yaml").write_text(agent_config_yaml(name))
        (agent_dir / "memory.md").write_text(AGENT_MEMORY_MD)
        (agent_dir / "state.json").write_text(AGENT_STATE_JSON)
        (agent_dir / "logs").mkdir()
        if has_chat:
            (agent_dir / "chat").mkdir()

    def _create_rules(self, root: Path) -> None:
        rules = root / "rules"
        rules.mkdir()
        (rules / "prime.md").write_text(PRIME_MD)

        schemas_dir = rules / "schemas"
        schemas_dir.mkdir()
        for filename, content in SCHEMAS.items():
            (schemas_dir / filename).write_text(content)

        policies_dir = rules / "policies"
        policies_dir.mkdir()
        for filename, content in POLICIES.items():
            (policies_dir / filename).write_text(content)

        workflows_dir = rules / "workflows"
        workflows_dir.mkdir()
        for filename, content in WORKFLOWS.items():
            (workflows_dir / filename).write_text(content)

    def _create_prompts(self, root: Path) -> None:
        prompts = root / "prompts"
        prompts.mkdir()
        (prompts / "_compiler.yaml").write_text(COMPILER_YAML)
        shared = prompts / "shared"
        shared.mkdir()
        (shared / "system-preamble.md").write_text(SYSTEM_PREAMBLE_MD)

    def _create_loom_meta(self, root: Path) -> None:
        loom_meta = root / ".loom"
        loom_meta.mkdir()
        changelog = loom_meta / "changelog"
        changelog.mkdir()
        for agent in ALL_AGENTS:
            (changelog / agent).mkdir()


# -- Module-level helpers for DI and backward compat --------------------------

_vault_manager: VaultManager | None = None


def get_vault_manager() -> VaultManager:
    """Return a cached VaultManager singleton (suitable for FastAPI Depends)."""
    global _vault_manager
    if _vault_manager is None:
        _vault_manager = VaultManager()
    return _vault_manager


def vault_path(vault_name: str | None = None) -> Path:
    """Return the root path for a vault."""
    name = vault_name or settings.active_vault
    return settings.vaults_dir / name


def threads_path(vault_name: str | None = None) -> Path:
    """Return the threads directory for a vault."""
    return vault_path(vault_name) / "threads"


def agents_path(vault_name: str | None = None) -> Path:
    """Return the agents directory for a vault."""
    return vault_path(vault_name) / "agents"
