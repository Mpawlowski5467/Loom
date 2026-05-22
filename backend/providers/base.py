"""Base provider interface."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import ClassVar, Literal

import httpx
from pydantic import BaseModel

from core.config import ProviderConfig

DEFAULT_TIMEOUT = httpx.Timeout(connect=2.0, read=8.0, write=8.0, pool=2.0)
ModelType = Literal["chat", "embed", "all"]


class ModelInfo(BaseModel):
    """One row in a provider's model list."""

    id: str
    name: str = ""
    type: Literal["chat", "embed"] = "chat"


class TestProviderResponse(BaseModel):
    """Result of pinging a provider for liveness/auth check."""

    ok: bool
    latency_ms: int = 0
    error: str | None = None


class BaseProvider(ABC):
    """Provider adapter.

    Subclasses set ``name`` and override :meth:`test` and :meth:`list_models`.
    Configuration arrives via ``ProviderConfig``; subclasses should pull
    ``api_key`` and ``host`` from there.
    """

    name: ClassVar[str]
    requires_api_key: ClassVar[bool] = True
    requires_host: ClassVar[bool] = False
    timeout: ClassVar[httpx.Timeout] = DEFAULT_TIMEOUT

    def __init__(self, config: ProviderConfig) -> None:
        self.config = config

    @abstractmethod
    async def test(self) -> TestProviderResponse:
        """Hit a lightweight endpoint to confirm auth + connectivity."""

    @abstractmethod
    async def list_models(self) -> tuple[list[ModelInfo], list[ModelInfo]]:
        """Return ``(chat_models, embed_models)``."""
