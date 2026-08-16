"""Security-posture diagnostics tests."""

from core.security_posture import DEFAULT_ALLOWED_HOSTS, inspect_security_posture


def test_default_posture_is_local_only(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.delenv("LOOM_ALLOWED_HOSTS", raising=False)
    monkeypatch.delenv("LOOM_SECRET_KEY", raising=False)
    monkeypatch.delenv("LOOM_SECRET_STORAGE", raising=False)

    posture = inspect_security_posture(api_token="")

    assert posture.allowed_hosts == list(DEFAULT_ALLOWED_HOSTS)
    assert posture.local_only is True
    assert posture.api_token_configured is False
    assert posture.secret_storage == "machine-local encrypted file"
    assert posture.warnings == []


def test_remote_host_without_token_is_flagged(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("LOOM_ALLOWED_HOSTS", "loom.example.com,localhost")

    posture = inspect_security_posture(api_token="")

    assert posture.local_only is False
    assert posture.warnings
    assert "without LOOM_API_TOKEN" in posture.warnings[0]


def test_remote_host_with_token_still_requires_real_edge_auth(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("LOOM_ALLOWED_HOSTS", "*")
    monkeypatch.setenv("LOOM_SECRET_KEY", "configured-outside-loom")

    posture = inspect_security_posture(api_token="secret")

    assert posture.api_token_configured is True
    assert posture.secret_storage == "environment-provided encryption key"
    assert "not multi-user authentication" in posture.warnings[0]


def test_keyring_request_is_visible_in_diagnostics(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.delenv("LOOM_SECRET_KEY", raising=False)
    monkeypatch.setenv("LOOM_SECRET_STORAGE", "keyring")

    posture = inspect_security_posture(api_token="")

    assert posture.secret_storage.startswith("OS keychain requested")
