"""Secret encryption for provider keys and private connection values at rest.

Provider API keys and private Calendar feed URLs are persisted to
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

The master key is read from the ``LOOM_SECRET_KEY`` environment variable if set.
Otherwise Loom uses ``~/.loom/.secret.key`` (chmod 600), or — when
``LOOM_SECRET_STORAGE=keyring`` and the optional keyring extra is available —
migrates that master key into the operating-system credential store.
"""

from __future__ import annotations

import logging
import os
import stat
from functools import lru_cache
from hashlib import sha256
from importlib import import_module
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

#: Marks a value as encrypted by this module. Versioned so the scheme can change.
ENC_PREFIX = "enc:v1:"

#: Env var that, when set, overrides the on-disk key file (base64 Fernet key).
ENV_KEY_VAR = "LOOM_SECRET_KEY"
STORAGE_MODE_VAR = "LOOM_SECRET_STORAGE"
KEYRING_SERVICE = "loom.local"
KEYRING_MARKER = "keyring:v1"


def _key_path() -> Path:
    """Location of the on-disk master key (sibling of ``config.yaml``)."""
    # Imported lazily to avoid a circular import: config imports secrets.
    from core.config import settings

    return settings.loom_home / ".secret.key"


def _keyring_marker_path() -> Path:
    return _key_path().with_name(".secret.backend")


def _keyring_account() -> str:
    """Stable, non-secret account name isolated by Loom home."""
    home = str(_key_path().parent.resolve())
    return f"master-key-{sha256(home.encode()).hexdigest()[:20]}"


def _storage_mode() -> str:
    mode = os.getenv(STORAGE_MODE_VAR, "file").strip().lower()
    if mode not in {"file", "keyring"}:
        logger.warning("Unknown %s=%r; using encrypted-file storage", STORAGE_MODE_VAR, mode)
        return "file"
    return mode


def _write_owner_only(path: Path, value: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(value)
    try:
        path.chmod(stat.S_IRUSR | stat.S_IWUSR)
    except OSError:  # pragma: no cover - platform dependent
        logger.debug("Could not chmod secret metadata at %s", path, exc_info=True)


def _valid_key(value: bytes) -> bytes:
    Fernet(value)
    return value


def _keyring_module() -> Any:
    return import_module("keyring")


def _load_or_migrate_keyring_key() -> bytes | None:
    """Return the keychain key, migrating the file key on explicit opt-in.

    Any unavailable/locked keychain fails closed to the caller, which may use
    the existing encrypted-file backend only when that key file still exists.
    A non-secret marker prevents silently generating a replacement key after a
    completed migration if the OS keychain later becomes unavailable.
    """
    path = _key_path()
    marker = _keyring_marker_path()
    account = _keyring_account()
    try:
        keyring = _keyring_module()
        stored = keyring.get_password(KEYRING_SERVICE, account)
        if stored:
            key = _valid_key(stored.strip().encode("utf-8"))
            if not marker.exists():
                _write_owner_only(marker, f"{KEYRING_MARKER}:{account}\n".encode())
            if path.exists() and path.read_bytes().strip() == key:
                path.unlink()
            return key

        key = _valid_key(path.read_bytes().strip()) if path.exists() else Fernet.generate_key()
        keyring.set_password(KEYRING_SERVICE, account, key.decode("ascii"))
        verified = keyring.get_password(KEYRING_SERVICE, account)
        if not verified or verified.strip().encode("utf-8") != key:
            raise RuntimeError("OS keychain did not return the stored Loom master key")
        _write_owner_only(marker, f"{KEYRING_MARKER}:{account}\n".encode())
        if path.exists():
            path.unlink()
        logger.info("Migrated Loom's encryption key into the OS keychain")
        return key
    except Exception as exc:
        logger.warning("OS keychain unavailable; encrypted-file fallback may be used: %s", exc)
        return None


def _load_or_create_key() -> bytes:
    """Return the master key, generating and persisting one if absent.

    Resolution order: ``LOOM_SECRET_KEY`` env var → opted-in OS keychain →
    ``~/.loom/.secret.key`` → freshly generated owner-only key.
    """
    env_key = os.getenv(ENV_KEY_VAR)
    if env_key:
        return env_key.strip().encode("utf-8")

    path = _key_path()
    if _storage_mode() == "keyring":
        keyring_key = _load_or_migrate_keyring_key()
        if keyring_key is not None:
            return keyring_key
        if _keyring_marker_path().exists() and not path.exists():
            raise RuntimeError(
                "Loom's master key is in the OS keychain, but that keychain is unavailable"
            )
    if path.exists():
        return _valid_key(path.read_bytes().strip())

    key = Fernet.generate_key()
    _write_owner_only(path, key)
    return key


def secret_storage_description() -> str:
    """Return a redaction-safe description for diagnostics."""
    if os.getenv(ENV_KEY_VAR):
        return "environment-provided encryption key"
    if _storage_mode() == "keyring":
        if _keyring_marker_path().exists():
            return "OS keychain-backed encryption key"
        return "OS keychain requested (encrypted-file fallback until available)"
    return "machine-local encrypted file"


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
            "Could not decrypt a stored secret (wrong or rotated master key). "
            "Re-enter it in Settings."
        )
        return None
    except RuntimeError as exc:
        logger.warning("Could not access Loom's secret-storage backend: %s", exc)
        return None
