"""Tests for config hardening in :mod:`core.config`.

Covers the schema-version field, the malformed-YAML crash guard, and
``${VAR}`` environment-variable expansion on load.
"""

from pathlib import Path

import pytest

from core.config import CaptureProcessingConfig, GlobalConfig, ProviderConfig, VaultConfig


class TestSchemaVersion:
    """``schema_version`` defaults to 1 and round-trips through load/save."""

    def test_global_defaults_to_one(self) -> None:
        assert GlobalConfig().schema_version == 1

    def test_vault_defaults_to_one(self) -> None:
        assert VaultConfig(name="default").schema_version == 1

    def test_global_defaults_when_absent_from_yaml(self, tmp_path: Path) -> None:
        path = tmp_path / "config.yaml"
        path.write_text("active_vault: default\n")
        assert GlobalConfig.load(path).schema_version == 1

    def test_vault_defaults_when_absent_from_yaml(self, tmp_path: Path) -> None:
        path = tmp_path / "vault.yaml"
        path.write_text("name: notes\n")
        assert VaultConfig.load(path).schema_version == 1

    def test_global_round_trips(self, tmp_path: Path) -> None:
        path = tmp_path / "config.yaml"
        GlobalConfig(schema_version=1).save(path)
        assert "schema_version" in path.read_text()
        assert GlobalConfig.load(path).schema_version == 1

    def test_vault_round_trips(self, tmp_path: Path) -> None:
        path = tmp_path / "vault.yaml"
        VaultConfig(name="notes").save(path)
        assert VaultConfig.load(path).schema_version == 1


class TestMalformedConfigGuard:
    """Corrupt YAML falls back to defaults instead of crashing."""

    def test_global_malformed_yaml_returns_defaults(self, tmp_path: Path) -> None:
        path = tmp_path / "config.yaml"
        # Unbalanced bracket -> yaml.YAMLError on parse.
        path.write_text("active_vault: [unclosed\n")
        cfg = GlobalConfig.load(path)
        assert cfg.active_vault == "default"
        assert cfg.schema_version == 1

    def test_global_non_mapping_returns_defaults(self, tmp_path: Path) -> None:
        path = tmp_path / "config.yaml"
        # Valid YAML, but a list rather than a mapping.
        path.write_text("- just\n- a\n- list\n")
        cfg = GlobalConfig.load(path)
        assert cfg.active_vault == "default"

    def test_vault_malformed_yaml_returns_defaults(self, tmp_path: Path) -> None:
        path = tmp_path / "vault.yaml"
        path.write_text("name: '''unterminated\n")
        cfg = VaultConfig.load(path)
        assert cfg.name == "default"

    def test_vault_non_mapping_returns_defaults(self, tmp_path: Path) -> None:
        path = tmp_path / "vault.yaml"
        path.write_text("42\n")
        cfg = VaultConfig.load(path)
        assert cfg.name == "default"


class TestEnvVarExpansion:
    """``${VAR}`` placeholders expand from the environment on load."""

    def test_expands_bare_placeholder(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("LOOM_TEST_KEY", "sk-from-env")
        path = tmp_path / "config.yaml"
        path.write_text(
            "providers:\n  openai:\n    api_key: ${LOOM_TEST_KEY}\n    chat_model: gpt-4o\n"
        )
        cfg = GlobalConfig.load(path)
        assert cfg.providers["openai"].api_key == "sk-from-env"

    def test_expands_top_level_value(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("LOOM_TEST_PROVIDER", "anthropic")
        path = tmp_path / "config.yaml"
        path.write_text("default_provider: ${LOOM_TEST_PROVIDER}\n")
        cfg = GlobalConfig.load(path)
        assert cfg.default_provider == "anthropic"

    def test_unset_var_uses_default_syntax(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("LOOM_TEST_MISSING", raising=False)
        path = tmp_path / "config.yaml"
        path.write_text(
            "providers:\n  openai:\n    "
            "api_key: ${LOOM_TEST_MISSING:-fallback-key}\n"
            "    chat_model: gpt-4o\n"
        )
        cfg = GlobalConfig.load(path)
        assert cfg.providers["openai"].api_key == "fallback-key"

    def test_unset_var_without_default_is_empty(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("LOOM_TEST_MISSING", raising=False)
        path = tmp_path / "config.yaml"
        path.write_text("default_provider: ${LOOM_TEST_MISSING}\n")
        cfg = GlobalConfig.load(path)
        assert cfg.default_provider == ""

    def test_non_placeholder_strings_untouched(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # An encrypted marker must survive expansion verbatim (it is decrypted
        # afterwards, not expanded). Use a literal that is not a real ciphertext
        # by asserting only that the expansion step leaves a non-${} string be.
        monkeypatch.setenv("LOOM_TEST_KEY", "should-not-be-used")
        path = tmp_path / "config.yaml"
        path.write_text(
            "providers:\n  openai:\n    api_key: plain-literal-key\n    chat_model: gpt-4o\n"
        )
        cfg = GlobalConfig.load(path)
        assert cfg.providers["openai"].api_key == "plain-literal-key"


def test_provider_config_unaffected_by_expansion_when_no_markers() -> None:
    """A ProviderConfig built directly is unchanged (sanity check)."""
    provider = ProviderConfig(api_key="direct", chat_model="gpt-4o")
    assert provider.api_key == "direct"


class TestCaptureProcessingStaleTimeout:
    """``stale_running_seconds`` defaults to 1800 and loads from config.yaml."""

    def test_default(self) -> None:
        assert CaptureProcessingConfig().stale_running_seconds == 1800.0

    def test_default_when_absent_from_yaml(self, tmp_path: Path) -> None:
        path = tmp_path / "config.yaml"
        path.write_text("capture_processing:\n  mode: trusted\n")
        cfg = GlobalConfig.load(path)
        assert cfg.capture_processing.stale_running_seconds == 1800.0

    def test_yaml_override(self, tmp_path: Path) -> None:
        path = tmp_path / "config.yaml"
        path.write_text("capture_processing:\n  stale_running_seconds: 900\n")
        cfg = GlobalConfig.load(path)
        assert cfg.capture_processing.stale_running_seconds == 900.0
