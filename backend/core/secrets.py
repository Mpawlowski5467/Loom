"""Secret encryption for API keys stored at rest.

API keys live on ``ProviderConfig.api_key`` and are persisted to
``~/.loom/config.yaml``. To avoid storing them in plain text, values are
encrypted with a machine-local master key (Fernet / AES-128-CBC + HMAC) and
written with an ``enc:v1:`` prefix so encrypted and legacy-plaintext values are
distinguishable on load.

Threat model — what this does and does NOT protect:

* **Protects:** ``config.yaml`` being copied, committed, or leaked *on its own*.
  Without the master key, the ciphertext is useless.
* **Does NOT protect:** anyone with read access to *both* ``config.yaml`` and the
  master key file (they're on the same disk), nor does it add authentication to
  the API. A reachable, unauthenticated backend port still lets a caller *use*
  the providers without ever seeing the key. Encryption-at-rest is defence in
  depth, not a substitute for an auth layer.

The master key is read from the ``LOOM_SECRET_KEY`` environment variable if set,
otherwise auto-generated once at ``~/.loom/.secret.key`` (chmod 600).
"""

from __future__ import annotations

import logging
import os
import stat
from functools import lru_cache
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

#: Marks a value as encrypted by this module. Versioned so the scheme can change.
ENC_PREFIX = "enc:v1:"

#: Env var that, when set, overrides the on-disk key file (base64 Fernet key).
ENV_KEY_VAR = "LOOM_SECRET_KEY"


def _key_path() -> Path:
    """Location of the on-disk master key (sibling of ``config.yaml``)."""
    # Imported lazily to avoid a circular import: config imports secrets.
    from core.config import settings

    return settings.loom_home / ".secret.key"


def _load_or_create_key() -> bytes:
    """Return the master key, generating and persisting one if absent.

    Resolution order: ``LOOM_SECRET_KEY`` env var → ``~/.loom/.secret.key`` →
    freshly generated key (written with owner-only permissions).
    """
    env_key = os.getenv(ENV_KEY_VAR)
    if env_key:
        return env_key.strip().encode("utf-8")

    path = _key_path()
    if path.exists():
        return path.read_bytes().strip()

    key = Fernet.generate_key()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(key)
    # Owner read/write only — best effort (no-op semantics on some filesystems).
    try:
        path.chmod(stat.S_IRUSR | stat.S_IWUSR)
    except OSError:  # pragma: no cover - platform dependent
        logger.debug("Could not chmod secret key at %s", path, exc_info=True)
    return key


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    """Cached Fernet instance built from the master key."""
    return Fernet(_load_or_create_key())


def reset_cipher_cache() -> None:
    """Clear the cached cipher (call after the key file / env var changes)."""
    _fernet.cache_clear()


def is_encrypted(value: str | None) -> bool:
    """Whether *value* is an encrypted token produced by :func:`encrypt`."""
    return bool(value) and value.startswith(ENC_PREFIX)  # type: ignore[union-attr]


def encrypt(value: str) -> str:
    """Encrypt a plaintext secret, returning an ``enc:v1:`` prefixed token.

    Already-encrypted values are returned unchanged so re-encryption is a no-op
    and callers can pass mixed plaintext/ciphertext freely.
    """
    if not value:
        return value
    if is_encrypted(value):
        return value
    token = _fernet().encrypt(value.encode("utf-8")).decode("ascii")
    return f"{ENC_PREFIX}{token}"


def decrypt(value: str | None) -> str | None:
    """Decrypt an ``enc:v1:`` token; pass through plaintext/empty unchanged.

    Legacy plaintext keys (no prefix) are returned as-is so existing configs
    keep working until their next save re-encrypts them. A token that fails to
    decrypt (wrong/rotated key) is treated as unusable and returns ``None`` with
    a warning, rather than crashing the whole config load.
    """
    if not value or not is_encrypted(value):
        return value
    token = value[len(ENC_PREFIX) :]
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken:
        logger.warning(
            "Could not decrypt a stored API key (wrong or rotated master key). "
            "Re-enter the key in Settings → Providers."
        )
        return None
