"""Cross-layer checks between the frontend theme registry, its CSS tokens, and
the backend ``ThemeName`` enum that onboarding still sends (the enum keeps the
pre-1.2 names; see docs/ui-backend-gaps.md §15)."""

from __future__ import annotations

import re
from pathlib import Path

from core.config import LEGACY_THEME_MIGRATIONS, ThemeName, UIState

FRONTEND_SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"
THEMES_CSS = FRONTEND_SRC / "styles" / "themes.css"
REGISTRY_TS = FRONTEND_SRC / "theme" / "registry.ts"
BACKEND_THEME_TS = FRONTEND_SRC / "theme" / "backendTheme.ts"

RULE_RE = re.compile(r"([^{}]+)\{([^{}]*)\}")
THEME_SELECTOR_RE = re.compile(r'^\[data-theme="([a-z-]+)"\]$')
TOKEN_RE = re.compile(r"--([\w-]+):\s*([^;]+);")
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

# Text pairs the frontend's contrast test also enforces (src/theme/contrast.test.ts).
AA_PAIRS = [
    *[
        ("muted-foreground", background)
        for background in ("background", "sidebar", "muted", "popover", "accent")
    ],
    ("ok-foreground", "ok"),
    ("warning-foreground", "warning"),
    ("danger-foreground", "background"),
    ("danger-foreground", "muted"),
]


def _frontend_theme_ids() -> list[str]:
    source = REGISTRY_TS.read_text(encoding="utf-8")
    block = re.search(r"export const THEMES[^=]*=\s*\[(.*?)\n\];", source, re.DOTALL)
    assert block is not None
    return re.findall(r'id:\s*"([a-z-]+)"', block.group(1))


def _theme_tokens() -> dict[str, dict[str, str]]:
    """Tokens per theme from rules whose selectors are only themes (or :root)."""
    source = re.sub(r"/\*.*?\*/", "", THEMES_CSS.read_text(encoding="utf-8"), flags=re.DOTALL)
    themes: dict[str, dict[str, str]] = {}
    for selectors, body in RULE_RE.findall(source):
        parts = [part.strip() for part in selectors.split(",")]
        if any(part != ":root" and not THEME_SELECTOR_RE.match(part) for part in parts):
            continue
        names = [match.group(1) for part in parts if (match := THEME_SELECTOR_RE.match(part))]
        for name in names:
            themes.setdefault(name, {}).update(TOKEN_RE.findall(body))
    return themes


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


def test_every_frontend_theme_has_a_css_token_block() -> None:
    ids = _frontend_theme_ids()
    assert len(ids) == len(set(ids)) == 6
    assert set(_theme_tokens()) == set(ids)


def test_every_frontend_theme_maps_to_a_backend_theme_name() -> None:
    source = BACKEND_THEME_TS.read_text(encoding="utf-8")
    block = re.search(r"BACKEND_THEME[^=]*=\s*\{(.*?)\};", source, re.DOTALL)
    assert block is not None
    mapping = dict(re.findall(r'"?([a-z-]+)"?:\s*"([a-z-]+)"', block.group(1)))
    assert set(mapping) == set(_frontend_theme_ids())
    assert set(mapping.values()) <= {theme.value for theme in ThemeName}


def test_legacy_theme_names_migrate_to_final_set() -> None:
    for legacy, replacement in LEGACY_THEME_MIGRATIONS.items():
        assert ThemeName(legacy) is replacement
        assert UIState(theme=legacy).theme is replacement


def test_small_and_status_text_meets_aa_contrast() -> None:
    for theme, tokens in _theme_tokens().items():
        for foreground, background in AA_PAIRS:
            ratio = _contrast(tokens[foreground], tokens[background])
            assert ratio >= 4.5, f"{theme} {foreground} on {background} is only {ratio:.2f}:1"
