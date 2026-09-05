"""Central policy checks used by capture ingress, embeddings and providers."""

from __future__ import annotations

from pathlib import Path

from core.config import AutomationPolicyConfig
from core.usage import UsageLedger


class AutomationPolicyError(RuntimeError):
    pass


class AutomationPausedError(AutomationPolicyError):
    pass


class DailyLimitExceeded(AutomationPolicyError):
    pass


def require_capture_allowed(
    root: Path, source: str, policy: AutomationPolicyConfig, *, automated: bool
) -> None:
    if automated and policy.paused:
        raise AutomationPausedError("Automated capture processing is paused")
    if automated and not UsageLedger(root).reserve_capture(
        source, policy.per_source_daily_capture_limit
    ):
        raise DailyLimitExceeded(f"Daily capture limit reached for source '{source}'")


def require_token_budget(
    root: Path, provider: str, text: str, policy: AutomationPolicyConfig
) -> None:
    # The shared tokenizer is an estimate across provider families. This limit
    # gates input before each attempt; generated output is accounted separately.
    from core.tokens import count_tokens

    estimated_tokens = max(1, count_tokens(text))
    if not UsageLedger(root).reserve_tokens(provider, estimated_tokens, policy.daily_token_limit):
        raise DailyLimitExceeded("Daily provider token limit reached")


def cloud_content_allowed(
    path: Path, tags: list[str], vault_root: Path, policy: AutomationPolicyConfig
) -> bool:
    """Return whether a note may be sent to a cloud provider or embedder."""
    try:
        relative = path.resolve().relative_to((vault_root / "threads").resolve())
        folder = "/".join(relative.parts[:-1]).lower()
    except ValueError:
        return False
    excluded_folders = set(policy.excluded_cloud_folders)
    if folder in excluded_folders or any(
        folder.startswith(item + "/") for item in excluded_folders
    ):
        return False
    return not bool({tag.strip().lower() for tag in tags} & set(policy.excluded_cloud_tags))


def note_allowed_for_provider(
    provider: object | None, path: Path, tags: list[str], vault_root: Path
) -> bool:
    """Apply folder/tag exclusions only when this provider leaves the machine."""
    if provider is None:
        return True
    name = str(getattr(provider, "name", "") or getattr(provider, "_provider_name", ""))
    if not is_cloud_provider(name):
        return True
    root = vault_root.resolve()
    if root.parent.name != "vaults":
        return True
    from core.config import GlobalConfig

    return cloud_content_allowed(
        path, tags, root, GlobalConfig.load(root.parent.parent / "config.yaml").automation_policy
    )


def is_cloud_provider(name: str) -> bool:
    # Codex is a remote model service even when invoked through the desktop
    # bridge. Ollama is the only built-in provider whose inference stays local.
    return name.strip().lower() != "ollama"


def automation_is_paused(vault_root: Path) -> bool:
    """Read the owning global policy without treating ad-hoc vaults as paused."""
    from core.config import GlobalConfig

    root = vault_root.resolve()
    return (
        root.parent.name == "vaults"
        and GlobalConfig.load(root.parent.parent / "config.yaml").automation_policy.paused
    )
