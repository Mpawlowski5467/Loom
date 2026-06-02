"""Tests for core/tokens.py — token counting and truncation."""

from __future__ import annotations

import pytest

import core.tokens as tokens_mod
from core.tokens import count_tokens, truncate_to_tokens


@pytest.fixture(autouse=True)
def _reset_encoding_cache():
    """Reset the lazily-cached encoding so fallback tests are isolated."""
    prev = tokens_mod._encoding
    tokens_mod._encoding = None
    yield
    tokens_mod._encoding = prev


class TestCountTokens:
    def test_empty_is_zero(self) -> None:
        assert count_tokens("") == 0

    def test_counts_tokens(self) -> None:
        # A short phrase tokenizes to a small positive count.
        n = count_tokens("hello world, this is a test")
        assert n > 0
        # Token count is always <= word*ish but well under char count.
        assert n < len("hello world, this is a test")

    def test_fallback_uses_char_divisor(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """When the encoding can't load, count ≈ len // 4."""
        monkeypatch.setattr(tokens_mod, "_get_encoding", lambda: None)
        text = "x" * 400
        assert count_tokens(text) == 100  # 400 // 4


class TestTruncateToTokens:
    def test_truncates_to_token_budget(self) -> None:
        text = " ".join(f"word{i}" for i in range(500))
        out = truncate_to_tokens(text, 50)
        assert count_tokens(out) <= 50
        # The result is a prefix-ish of the original (starts the same).
        assert text.startswith(out[:10])

    def test_short_text_unchanged(self) -> None:
        text = "just a few tokens"
        assert truncate_to_tokens(text, 1000) == text

    def test_zero_or_negative_budget_yields_empty(self) -> None:
        assert truncate_to_tokens("anything", 0) == ""
        assert truncate_to_tokens("anything", -5) == ""

    def test_empty_text_unchanged(self) -> None:
        assert truncate_to_tokens("", 10) == ""

    def test_fallback_slices_by_chars(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """When the encoding can't load, truncation slices at max_tokens*4 chars."""
        monkeypatch.setattr(tokens_mod, "_get_encoding", lambda: None)
        text = "y" * 1000
        out = truncate_to_tokens(text, 10)
        assert out == "y" * 40  # 10 tokens * 4 chars

    def test_fallback_short_text_unchanged(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(tokens_mod, "_get_encoding", lambda: None)
        text = "short"
        assert truncate_to_tokens(text, 10) == text


class TestEncodingCacheFailureSticky:
    def test_failed_load_is_cached(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """A failing tiktoken load is attempted once, then cached as fallback."""
        calls = {"n": 0}

        def _boom(_name: str):
            calls["n"] += 1
            raise RuntimeError("no encoding files")

        import tiktoken

        monkeypatch.setattr(tiktoken, "get_encoding", _boom)
        tokens_mod._encoding = None

        # Two calls; the load should only be attempted once (then cached False).
        assert count_tokens("a" * 8) == 2  # 8 // 4 via fallback
        assert count_tokens("a" * 8) == 2
        assert calls["n"] == 1
