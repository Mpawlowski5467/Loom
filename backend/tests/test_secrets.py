"""Tests for core.secrets — API-key encryption at rest."""

from __future__ import annotations

from typing import TYPE_CHECKING

import core.secrets as secrets_mod

if TYPE_CHECKING:
    from pathlib import Path

    import pytest


def _fresh_secrets(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Point core.secrets at an isolated home with a fresh, env-key-free cipher.

    ``LoomSettings.loom_home`` is bound at import; rather than fight env-var
    precedence, patch the live ``settings.loom_home`` so ``_key_path()`` resolves
    into ``tmp_path``.
    """
    monkeypatch.delenv("LOOM_SECRET_KEY", raising=False)
    from core.config import settings

    monkeypatch.setattr(settings, "loom_home", tmp_path)
    secrets_mod.reset_cipher_cache()
    return secrets_mod


def test_round_trip(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """encrypt → decrypt returns the original plaintext."""
    s = _fresh_secrets(tmp_path, monkeypatch)
    token = s.encrypt("sk-abc-123")
    assert token != "sk-abc-123"
    assert s.is_encrypted(token)
    assert token.startswith(s.ENC_PREFIX)
    assert s.decrypt(token) == "sk-abc-123"


def test_key_file_created_with_owner_only_perms(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The master key is written to ~/.loom/.secret.key, readable by owner only."""
    s = _fresh_secrets(tmp_path, monkeypatch)
    s.encrypt("x")  # forces key creation
    key_file = tmp_path / ".secret.key"
    assert key_file.exists()
    # Lower 9 permission bits should be 0o600 (owner rw only).
    assert (key_file.stat().st_mode & 0o777) == 0o600


def test_plaintext_passthrough(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Legacy un-prefixed values decrypt to themselves (backward compatible)."""
    s = _fresh_secrets(tmp_path, monkeypatch)
    assert s.decrypt("legacy-plaintext") == "legacy-plaintext"
    assert not s.is_encrypted("legacy-plaintext")


def test_empty_and_none(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Empty / None pass through both directions without error."""
    s = _fresh_secrets(tmp_path, monkeypatch)
    assert s.encrypt("") == ""
    assert s.decrypt("") == ""
    assert s.decrypt(None) is None


def test_double_encrypt_is_noop(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Encrypting an already-encrypted value returns it unchanged."""
    s = _fresh_secrets(tmp_path, monkeypatch)
    once = s.encrypt("secret")
    twice = s.encrypt(once)
    assert once == twice
    assert s.decrypt(twice) == "secret"


def test_env_key_overrides_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """LOOM_SECRET_KEY, when set, is used instead of any on-disk key file."""
    from cryptography.fernet import Fernet

    from core.config import settings

    monkeypatch.setattr(settings, "loom_home", tmp_path)
    monkeypatch.setenv("LOOM_SECRET_KEY", Fernet.generate_key().decode())
    s = secrets_mod
    s.reset_cipher_cache()
    token = s.encrypt("via-env")
    assert s.decrypt(token) == "via-env"
    # No key file written when the env var supplies the key.
    assert not (tmp_path / ".secret.key").exists()


def test_wrong_key_returns_none(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A token that can't be decrypted (rotated key) yields None, not a crash."""
    s = _fresh_secrets(tmp_path, monkeypatch)
    token = s.encrypt("secret")
    # Rotate: delete the key file and reset the cache so a new key is generated.
    (tmp_path / ".secret.key").unlink()
    s.reset_cipher_cache()
    assert s.decrypt(token) is None
