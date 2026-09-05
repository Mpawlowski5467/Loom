"""Automation, privacy, and provider-budget policy settings."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from core.config import AutomationPolicyConfig, GlobalConfig
from core.usage import UsageLedger
from core.vault import VaultManager, get_vault_manager

router = APIRouter(prefix="/api/policy", tags=["policy"])


@router.get("")
async def get_policy(
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> dict[str, object]:
    config = GlobalConfig.load(vm.config_path())
    return {
        "policy": config.automation_policy.model_dump(mode="json"),
        "usage": UsageLedger(vm.active_vault_dir()).summary(
            config.automation_policy.provider_prices_per_1k
        ),
    }


@router.patch("")
async def update_policy(
    body: AutomationPolicyConfig,
    vm: VaultManager = Depends(get_vault_manager),  # noqa: B008
) -> dict[str, object]:
    config_path = vm.config_path()
    config = GlobalConfig.load(config_path)
    config.automation_policy = body
    config.save(config_path)
    return {
        "policy": body.model_dump(mode="json"),
        "usage": UsageLedger(vm.active_vault_dir()).summary(body.provider_prices_per_1k),
    }
