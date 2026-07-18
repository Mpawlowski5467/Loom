"""Regression tests for LoomSettings environment variable resolution."""

from pathlib import Path

from core.config import LoomSettings


class TestLoomHomeEnvVar:
    """The Docker image and compose set LOOM_HOME — it must actually be read.

    With the class-level ``env_prefix = "LOOM_"``, the field name alone would
    derive ``LOOM_LOOM_HOME`` and silently ignore the documented ``LOOM_HOME``,
    leaving the container writing vaults to ``~/.loom`` instead of the mounted
    volume. Pinned by the explicit ``validation_alias`` on the field.
    """

    def test_loom_home_env_var_is_honored(self, monkeypatch, tmp_path):
        monkeypatch.setenv("LOOM_HOME", str(tmp_path))
        assert LoomSettings().loom_home == tmp_path

    def test_derived_loom_loom_home_still_accepted(self, monkeypatch, tmp_path):
        monkeypatch.setenv("LOOM_LOOM_HOME", str(tmp_path))
        assert LoomSettings().loom_home == tmp_path

    def test_loom_home_wins_over_derived_name(self, monkeypatch, tmp_path):
        documented = tmp_path / "documented"
        derived = tmp_path / "derived"
        monkeypatch.setenv("LOOM_HOME", str(documented))
        monkeypatch.setenv("LOOM_LOOM_HOME", str(derived))
        assert LoomSettings().loom_home == documented

    def test_default_is_home_dot_loom(self, monkeypatch):
        monkeypatch.delenv("LOOM_HOME", raising=False)
        monkeypatch.delenv("LOOM_LOOM_HOME", raising=False)
        assert LoomSettings().loom_home == Path.home() / ".loom"
