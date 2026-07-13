"""Cross-layer parity and accessibility checks for the shipped theme registry."""

from __future__ import annotations

import re
from pathlib import Path

from core.config import LEGACY_THEME_MIGRATIONS, ThemeName, UIState

REPO_ROOT = Path(__file__).resolve().parents[2]
TOKENS_PATH = REPO_ROOT / "frontend" / "src" / "styles" / "tokens.css"
THEMES_PATH = REPO_ROOT / "frontend" / "src" / "theme" / "themes.ts"
BASE_STYLES_PATH = REPO_ROOT / "frontend" / "src" / "styles" / "base.css"

THEME_BLOCK_RE = re.compile(r"(?s)(?::root,\s*)?\.theme-([a-z-]+)\s*\{(.*?)\n\}")
TOKEN_RE = re.compile(r"--([\w-]+):\s*([^;]+);")
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _theme_blocks() -> dict[str, dict[str, str]]:
    source = TOKENS_PATH.read_text(encoding="utf-8")
    return {name: dict(TOKEN_RE.findall(body)) for name, body in THEME_BLOCK_RE.findall(source)}


def _relative_luminance(color: str) -> float:
    assert HEX_RE.fullmatch(color), f"Expected a six-digit hex color, got {color!r}"
    channels = [int(color[index : index + 2], 16) / 255 for index in (1, 3, 5)]
    linear = [
        value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4
        for value in channels
    ]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def _contrast(first: str, second: str) -> float:
    first_luminance = _relative_luminance(first)
    second_luminance = _relative_luminance(second)
    lighter = max(first_luminance, second_luminance)
    darker = min(first_luminance, second_luminance)
    return (lighter + 0.05) / (darker + 0.05)


def test_frontend_backend_and_css_theme_registries_match() -> None:
    blocks = _theme_blocks()
    backend_names = {theme.value for theme in ThemeName}

    source = THEMES_PATH.read_text(encoding="utf-8")
    array_match = re.search(r"export const THEMES: ThemeName\[\] = \[(.*?)\];", source, re.DOTALL)
    assert array_match is not None
    frontend_names = re.findall(r'"([a-z-]+)"', array_match.group(1))

    assert len(frontend_names) == len(set(frontend_names))
    assert set(frontend_names) == backend_names
    assert set(blocks) == backend_names | set(LEGACY_THEME_MIGRATIONS)

    migration_match = re.search(r"LEGACY_THEME_MIGRATIONS[^=]*=\s*\{(.*?)\};", source, re.DOTALL)
    assert migration_match is not None
    frontend_migrations = dict(re.findall(r'(\w+):\s*"([a-z-]+)"', migration_match.group(1)))
    backend_migrations = {
        legacy: replacement.value for legacy, replacement in LEGACY_THEME_MIGRATIONS.items()
    }
    assert frontend_migrations == backend_migrations


def test_legacy_theme_names_migrate_to_final_set() -> None:
    for legacy, replacement in LEGACY_THEME_MIGRATIONS.items():
        assert ThemeName(legacy) is replacement
        assert UIState(theme=legacy).theme is replacement


def test_small_text_and_semantic_status_colors_meet_aa_contrast() -> None:
    for theme, tokens in _theme_blocks().items():
        for foreground in ("ink-3", "success", "warning", "danger"):
            for background in ("bg-base", "bg-surface", "bg-elevated"):
                ratio = _contrast(tokens[foreground], tokens[background])
                assert ratio >= 4.5, f"{theme} {foreground} on {background} is only {ratio:.2f}:1"


def test_semantic_status_aliases_remain_backward_compatible() -> None:
    for theme, tokens in _theme_blocks().items():
        assert tokens["green"] == "var(--success)", theme
        assert tokens["green-bg"] == "var(--success-bg)", theme
        assert tokens["red"] == "var(--danger)", theme
        assert "success-bg" in tokens, theme
        assert "warning-bg" in tokens, theme
        assert "danger-bg" in tokens, theme


def test_paper_grain_fallback_does_not_match_every_light_theme() -> None:
    source = BASE_STYLES_PATH.read_text(encoding="utf-8")
    assert ':root:not([class*="theme-"]) body' in source
    assert re.search(r"(?m)^:root body,?$", source) is None
