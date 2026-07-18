"""Loom configuration models.

Two layers:

* :class:`LoomSettings` — environment-driven app settings (env vars, ``LOOM_*``).
* :class:`GlobalConfig` — YAML-persisted state at ``~/.loom/config.yaml``
  (providers, active vault, UI prefs, onboarding gate).

Provider keys and private connection URLs are plain text only in memory. On
disk (``~/.loom/config.yaml``) they are encrypted with a machine-local master
key (see :mod:`core.secrets`) and an ``enc:v1:`` prefix. Load/save decrypt and
encrypt transparently; legacy plaintext values migrate on the next save.
``GlobalConfig.to_public()`` returns a redacted frontend-safe view.

Encryption at rest protects ``config.yaml`` if it leaks on its own; it does not
add API authentication, so the backend port must still not be exposed.
"""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Any, Literal, Self

import yaml
from pydantic import AliasChoices, BaseModel, Field, field_validator
from pydantic_settings import BaseSettings

from core.hardware import HardwareProfile

logger = logging.getLogger(__name__)

# Matches a bare ``${VAR}`` or ``${VAR:-default}`` placeholder occupying the
# whole string. VAR is a conventional env-var name (uppercase + underscores).
_ENV_VAR_PATTERN = re.compile(r"^\$\{([A-Z_][A-Z0-9_]*)(?::-([^}]*))?\}$")


def _expand_env_str(value: str) -> str:
    """Expand a single ``${VAR}`` / ``${VAR:-default}`` placeholder.

    Only fully-placeholder strings are expanded; any other string (including the
    ``enc:v1:`` encrypted markers) is returned unchanged so this never touches
    ciphertext. Unset vars resolve to their ``:-default`` or to an empty string.
    """
    match = _ENV_VAR_PATTERN.match(value)
    if match is None:
        return value
    var_name, default = match.group(1), match.group(2)
    return os.environ.get(var_name, default if default is not None else "")


def _expand_env_vars(data: Any) -> Any:
    """Recursively expand ``${VAR}`` placeholders in a loaded config dict.

    Walks nested dicts and lists (covering top-level keys and provider
    sub-dicts), replacing any string that is exactly a ``${VAR}`` or
    ``${VAR:-default}`` placeholder with the environment value. Must run on
    plaintext YAML *before* decryption so it never rewrites ``enc:v1:`` values.
    """
    if isinstance(data, dict):
        return {key: _expand_env_vars(val) for key, val in data.items()}
    if isinstance(data, list):
        return [_expand_env_vars(item) for item in data]
    if isinstance(data, str):
        return _expand_env_str(data)
    return data


def _safe_load_yaml(path: Path) -> dict[str, Any] | None:
    """Parse a YAML file into a dict, tolerating corruption.

    Returns the parsed mapping, an empty dict for an empty file, or ``None`` if
    the file is malformed (``yaml.YAMLError``) or does not parse to a mapping.
    Callers fall back to defaults on ``None`` rather than crashing at import.
    """
    try:
        data = yaml.safe_load(path.read_text())
    except yaml.YAMLError:
        logger.warning("Malformed YAML at %s; falling back to defaults.", path)
        return None
    if data is None:
        return {}
    if not isinstance(data, dict):
        logger.warning("Config at %s is not a mapping; falling back to defaults.", path)
        return None
    return data


class LoomSettings(BaseSettings):
    """Environment-driven app configuration."""

    loom_home: Path = Field(
        default=Path.home() / ".loom",
        # The class env_prefix would derive LOOM_LOOM_HOME; every deployment
        # doc and the Docker image set LOOM_HOME, so name it explicitly.
        # LOOM_LOOM_HOME stays accepted for anyone who discovered the derived
        # name in the wild.
        validation_alias=AliasChoices("LOOM_HOME", "LOOM_LOOM_HOME"),
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
    api_token: str = Field(
        default="",
        description=(
            "Optional shared secret for the API. Empty (the default) disables the "
            "gate and the API stays open — the supported localhost posture. When "
            "set via LOOM_API_TOKEN, every /api request except the health/readiness "
            "probes must present the token as 'Authorization: Bearer <token>' or "
            "'X-Loom-Token: <token>'. A speed bump for exposed ports, not auth for "
            "untrusted networks."
        ),
    )
    redis_url: str = Field(
        default="",
        description=(
            "Optional Redis URL (e.g. redis://localhost:6379/0) for the LLM "
            "response cache. Empty (the default) disables caching entirely — "
            "set via LOOM_REDIS_URL. Redis being down degrades to cache misses."
        ),
    )
    database_url: str = Field(
        default="",
        description=(
            "Optional Postgres URL (e.g. postgresql://loom:loom@localhost/loom) "
            "for the durable trace/run mirror. Empty (the default) disables it — "
            "set via LOOM_DATABASE_URL. The in-memory ring and disk mirror are "
            "unaffected either way."
        ),
    )
    trace_retention_days: int = Field(
        default=30,
        description=(
            "Days of persisted traces and run summaries to keep (today counts "
            "as day 0). A daily background sweep prunes the on-disk mirror and, "
            "when configured, the Postgres mirror. Set via "
            "LOOM_TRACE_RETENTION_DAYS; a negative value disables pruning."
        ),
    )
    demo_vault_dir: Path = Field(
        # Source checkout: <repo>/examples/demo-vault, three levels up from this
        # module (backend/core/config.py). The Docker image pip-installs the
        # package — so that relative path won't resolve there — and sets
        # LOOM_DEMO_VAULT_DIR to the copied template instead (env wins over this).
        default_factory=lambda: Path(__file__).resolve().parents[2] / "examples" / "demo-vault",
        description=(
            "Template vault seeded by the onboarding 'Try the demo vault' option. "
            "Override with LOOM_DEMO_VAULT_DIR."
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

    model_config = {"env_prefix": "LOOM_", "populate_by_name": True}


settings = LoomSettings()


# -- Persisted YAML config models ---------------------------------------------


class ThemeName(StrEnum):
    """Final public themes shipped with Loom. Paper is the default.

    Keep in sync with ``frontend/src/theme/themes.ts`` and the ``.theme-*``
    blocks in ``frontend/src/styles/tokens.css``.
    """

    paper = "paper"
    porcelain = "porcelain"
    herbarium = "herbarium"
    midnight = "midnight"
    lagoon = "lagoon"
    ember = "ember"

    @classmethod
    def _missing_(cls, value: object) -> ThemeName | None:
        """Accept retired names anywhere a theme enters the API or config."""
        if isinstance(value, str):
            return LEGACY_THEME_MIGRATIONS.get(value)
        return None


LEGACY_THEME_MIGRATIONS: dict[str, ThemeName] = {
    "slate": ThemeName.porcelain,
    "foundry": ThemeName.paper,
    "dune": ThemeName.herbarium,
    "carbon": ThemeName.midnight,
    "obsidian": ThemeName.midnight,
    "mulberry": ThemeName.ember,
    "nocturne": ThemeName.midnight,
}


class ProviderConfig(BaseModel):
    """Configuration for a single LLM provider."""

    api_key: str | None = None
    chat_model: str = "gpt-4o"
    embed_model: str | None = None
    host: str | None = None
    # Custom API endpoint for OpenAI-compatible providers (xai, openrouter).
    # None falls back to each provider's hardcoded default base_url.
    base_url: str | None = None

    def to_public(self) -> ProviderConfigPublic:
        """Return a redacted view safe for the API."""
        return ProviderConfigPublic(
            api_key_set=bool(self.api_key),
            chat_model=self.chat_model,
            embed_model=self.embed_model or "",
            host=self.host or "",
            base_url=self.base_url or "",
        )


class ProviderConfigPublic(BaseModel):
    """Provider config without the api_key — for outbound API responses."""

    api_key_set: bool
    chat_model: str = ""
    embed_model: str = ""
    host: str = ""
    base_url: str = ""


class RateLimitConfig(BaseModel):
    """Rate limit settings, configurable in config.yaml."""

    read: str = "120/minute"
    write: str = "30/minute"


class CaptureProcessingConfig(BaseModel):
    """Durable Inbox processing policy.

    ``manual`` never discovers/enqueues captures automatically. ``trusted``
    only accepts exact (case-insensitive) source matches from
    ``trusted_sources``; ``all`` accepts every valid capture. Explicit enqueue
    and retry requests are available in every mode. The allowlist is an
    automation policy, not authentication: capture ``source`` is caller-supplied
    provenance and must not be treated as a security boundary.
    """

    mode: Literal["manual", "trusted", "all"] = "manual"
    trusted_sources: list[str] = Field(default_factory=list, max_length=200)
    concurrency: int = Field(default=1, ge=1, le=8)
    max_retries: int = Field(default=2, ge=0, le=10)
    base_backoff_seconds: float = Field(default=2.0, ge=0.1, le=3600.0)

    @classmethod
    def _normalized_sources(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for raw in values:
            source = raw.strip().lower()
            if not source or source in seen:
                continue
            if len(source) > 200:
                raise ValueError("trusted sources must be at most 200 characters")
            seen.add(source)
            normalized.append(source)
        return normalized

    def model_post_init(self, __context: Any) -> None:
        """Normalize allowlist entries loaded from YAML or API payloads."""
        self.trusted_sources = self._normalized_sources(self.trusted_sources)

    def permits(self, source: str) -> bool:
        """Return whether a source should be discovered automatically."""
        if self.mode == "all":
            return True
        if self.mode == "trusted":
            return source.strip().lower() in set(self.trusted_sources)
        return False


class StandupScheduleConfig(BaseModel):
    """Per-install schedule for the active vault's Standup agent."""

    enabled: bool = False
    run_time: str = "08:00"
    timezone: str = "UTC"

    @field_validator("run_time")
    @classmethod
    def _valid_run_time(cls, value: str) -> str:
        value = value.strip()
        if len(value) > 5:
            raise ValueError("run_time must use 24-hour HH:MM format")
        if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
            raise ValueError("run_time must use 24-hour HH:MM format")
        return value

    @field_validator("timezone")
    @classmethod
    def _valid_timezone(cls, value: str) -> str:
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

        value = value.strip()
        if not value or len(value) > 100:
            raise ValueError("timezone must be a valid IANA timezone")
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("timezone must be a valid IANA timezone") from exc
        return value


class CalendarBridgeConfig(BaseModel):
    """Private read-only iCalendar connection used by Standup and Inbox."""

    enabled: bool = False
    feed_url: str | None = None
    name: str = "Calendar"
    include_in_standup: bool = True
    create_captures: bool = True

    @field_validator("feed_url")
    @classmethod
    def _normalize_feed_url(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        # Persisted private values are decrypted only after the full config is
        # validated, matching provider API-key handling below.
        if value.startswith("enc:v1:"):
            return value
        from bridge.calendar import normalize_feed_url

        return normalize_feed_url(value)

    @field_validator("name")
    @classmethod
    def _normalize_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("calendar name must not be blank")
        if len(value) > 300:
            raise ValueError("calendar name must be at most 300 characters")
        if any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise ValueError("calendar name must be a single printable line")
        return value

    def to_public(self) -> CalendarBridgeConfigPublic:
        return CalendarBridgeConfigPublic(
            enabled=self.enabled,
            feed_url_set=bool(self.feed_url),
            name=self.name,
            include_in_standup=self.include_in_standup,
            create_captures=self.create_captures,
        )


class CalendarBridgeConfigPublic(BaseModel):
    """Calendar connection state without its private feed URL."""

    enabled: bool
    feed_url_set: bool
    name: str
    include_in_standup: bool
    create_captures: bool


class UIState(BaseModel):
    """Persisted UI preferences."""

    theme: ThemeName = ThemeName.paper


class AgentModelOverride(BaseModel):
    """Per-agent chat provider/model override.

    Both fields are optional: a bare ``chat_model`` rides the default chat
    provider; a bare ``provider`` uses that provider's configured model.
    """

    provider: str | None = None
    chat_model: str | None = None


class OnboardingState(BaseModel):
    """Server-side onboarding gate.

    ``completed`` is the single source of truth that gates the wizard.
    """

    completed: bool = False
    completed_at: datetime | None = None
    steps_done: list[str] = Field(default_factory=list)


class GlobalConfig(BaseModel):
    """Maps to ~/.loom/config.yaml."""

    schema_version: int = Field(
        default=1,
        description="Config schema version; future migrations dispatch on this.",
    )
    active_vault: str = "default"
    default_provider: str = "openai"
    providers: dict[str, ProviderConfig] = {}
    embed_provider: str | None = None
    chat_provider: str | None = None
    rate_limit: RateLimitConfig = Field(default_factory=RateLimitConfig)
    capture_processing: CaptureProcessingConfig = Field(default_factory=CaptureProcessingConfig)
    standup_schedule: StandupScheduleConfig = Field(default_factory=StandupScheduleConfig)
    calendar: CalendarBridgeConfig = Field(default_factory=CalendarBridgeConfig)
    ui: UIState = Field(default_factory=UIState)
    onboarding: OnboardingState = Field(default_factory=OnboardingState)
    agent_models: dict[str, AgentModelOverride] = Field(default_factory=dict)
    hardware: HardwareProfile | None = None

    @classmethod
    def load(cls, path: Path) -> Self:
        """Load from a YAML file, expanding env vars and decrypting keys.

        Steps, in order:

        1. Missing file → return defaults.
        2. Malformed YAML (or a non-mapping document) → log and return defaults
           rather than crashing import-time consumers (registry, rate limiter).
        3. Expand any ``${VAR}`` / ``${VAR:-default}`` placeholder string from
           the environment (top-level keys and provider sub-dicts). This runs on
           plaintext before decryption, so it never touches ``enc:v1:`` values.
        4. Provider ``api_key`` values written with the ``enc:v1:`` prefix are
           decrypted to plain text in memory; legacy plaintext keys pass through
           unchanged (and get re-encrypted on the next :meth:`save`).

        ``schema_version`` defaults to 1 when absent from the YAML.
        """
        if not path.exists():
            return cls()
        data = _safe_load_yaml(path)
        if data is None:
            return cls()
        data = _expand_env_vars(data)
        cfg = cls.model_validate(data)
        cfg._decrypt_keys()
        return cfg

    def save(self, path: Path) -> None:
        """Write to a YAML file, encrypting provider keys at rest.

        Encryption happens on a deep copy so the in-memory config keeps its
        plaintext keys (the running app needs them). Writes atomically via a
        temp file. Creates parent directories as needed.
        """
        path.parent.mkdir(parents=True, exist_ok=True)
        to_write = self.model_copy(deep=True)
        to_write._encrypt_keys()
        tmp_path = path.with_suffix(f"{path.suffix}.tmp")
        tmp_path.write_text(
            yaml.safe_dump(
                to_write.model_dump(exclude_none=True, mode="json"),
                default_flow_style=False,
                sort_keys=False,
            ),
        )
        tmp_path.replace(path)

    def _decrypt_keys(self) -> None:
        """Decrypt provider keys and private connection URLs in place."""
        from core.secrets import decrypt

        for provider in self.providers.values():
            if provider.api_key:
                provider.api_key = decrypt(provider.api_key)
        if self.calendar.feed_url:
            decrypted = decrypt(self.calendar.feed_url)
            if decrypted:
                from bridge.calendar import CalendarFeedError, normalize_feed_url

                try:
                    self.calendar.feed_url = normalize_feed_url(decrypted)
                except CalendarFeedError:
                    logger.warning("Stored calendar feed URL is invalid; reconnect it in Settings.")
                    self.calendar.feed_url = None
            else:
                self.calendar.feed_url = None

    def _encrypt_keys(self) -> None:
        """Encrypt provider keys and private connection URLs in place."""
        from core.secrets import encrypt

        for provider in self.providers.values():
            if provider.api_key:
                provider.api_key = encrypt(provider.api_key)
        if self.calendar.feed_url:
            self.calendar.feed_url = encrypt(self.calendar.feed_url)

    def to_public(self) -> GlobalConfigPublic:
        """Return a serialization-safe view (api keys redacted)."""
        return GlobalConfigPublic(
            active_vault=self.active_vault,
            default_provider=self.default_provider,
            providers={name: cfg.to_public() for name, cfg in self.providers.items()},
            capture_processing=self.capture_processing,
            standup_schedule=self.standup_schedule,
            calendar=self.calendar.to_public(),
            ui=self.ui,
            onboarding=self.onboarding,
        )


class GlobalConfigPublic(BaseModel):
    """Serializable, redacted view of GlobalConfig."""

    active_vault: str
    default_provider: str
    providers: dict[str, ProviderConfigPublic]
    capture_processing: CaptureProcessingConfig
    standup_schedule: StandupScheduleConfig
    calendar: CalendarBridgeConfigPublic
    ui: UIState
    onboarding: OnboardingState


class VaultConfig(BaseModel):
    """Maps to a vault's vault.yaml."""

    schema_version: int = Field(
        default=1,
        description="Config schema version; future migrations dispatch on this.",
    )
    name: str
    custom_folders: list[str] = []
    auto_git: bool = False
    memory_summarize_cadence: int = Field(
        default=20,
        description="Number of agent actions between memory summarizations",
    )

    @classmethod
    def load(cls, path: Path) -> Self:
        """Load from a YAML file, tolerating a missing or malformed file.

        Returns defaults (``name="default"``) when the file is missing, or when
        the YAML is malformed / not a mapping (logged, never raised).
        ``schema_version`` defaults to 1 when absent from the YAML.
        """
        if not path.exists():
            return cls(name="default")
        data = _safe_load_yaml(path)
        if data is None:
            return cls(name="default")
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
