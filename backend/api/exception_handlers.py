"""Global FastAPI exception handlers for Loom domain errors."""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from core.exceptions import (
    InvalidVaultNameError,
    LoomError,
    NoteNotFoundError,
    ProviderConfigError,
    ProviderError,
    ReadChainError,
    VaultExistsError,
    VaultNotFoundError,
)


def _error_response(status_code: int, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": str(exc), "type": exc.__class__.__name__},
    )


def register_exception_handlers(app: FastAPI) -> None:
    """Attach all Loom domain exception handlers to the FastAPI app."""

    @app.exception_handler(VaultNotFoundError)
    async def _vault_not_found(request: Request, exc: VaultNotFoundError) -> JSONResponse:
        return _error_response(404, exc)

    @app.exception_handler(NoteNotFoundError)
    async def _note_not_found(request: Request, exc: NoteNotFoundError) -> JSONResponse:
        return _error_response(404, exc)

    @app.exception_handler(VaultExistsError)
    async def _vault_exists(request: Request, exc: VaultExistsError) -> JSONResponse:
        return _error_response(409, exc)

    @app.exception_handler(InvalidVaultNameError)
    async def _invalid_vault_name(request: Request, exc: InvalidVaultNameError) -> JSONResponse:
        return _error_response(422, exc)

    @app.exception_handler(ProviderConfigError)
    async def _provider_config(request: Request, exc: ProviderConfigError) -> JSONResponse:
        return _error_response(503, exc)

    @app.exception_handler(ReadChainError)
    async def _read_chain(request: Request, exc: ReadChainError) -> JSONResponse:
        return _error_response(403, exc)

    @app.exception_handler(ProviderError)
    async def _provider_error(request: Request, exc: ProviderError) -> JSONResponse:
        return _error_response(502, exc)

    @app.exception_handler(LoomError)
    async def _loom_error(request: Request, exc: LoomError) -> JSONResponse:
        return _error_response(500, exc)
