import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { applyTheme } from "../../theme/applyTheme";
import {
  THEME_META,
  THEMES,
  themesByMode,
  type ThemeMode,
  type ThemeName,
} from "../../theme/themes";
import { ThemeSwatch } from "../ThemeSwatch";

interface Props {
  selected: ThemeName;
  onChange: (theme: ThemeName) => void;
  onNext: () => void;
  onBack: () => void;
}

interface ThemePickerGridProps {
  selected: ThemeName;
  onChange: (theme: ThemeName) => void;
  className?: string;
}

const MODE_GROUPS: { mode: ThemeMode; label: string }[] = [
  { mode: "light", label: "Light" },
  { mode: "dark", label: "Dark" },
];

export function ThemePickerGrid({
  selected,
  onChange,
  className = "onb-theme-grid",
}: ThemePickerGridProps): ReactNode {
  const committedRef = useRef<ThemeName>(selected);

  useEffect(() => {
    committedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    return () => {
      applyTheme(committedRef.current);
    };
  }, []);

  const preview = (theme: ThemeName) => applyTheme(theme);
  const restore = () => applyTheme(committedRef.current);
  const commit = (theme: ThemeName) => {
    committedRef.current = theme;
    applyTheme(theme);
    onChange(theme);
  };

  const card = (name: ThemeName): ReactNode => {
    const meta = THEME_META[name];
    const active = selected === name;
    return (
      <button
        key={name}
        type="button"
        role="radio"
        aria-checked={active}
        className={`onb-theme-card ${active ? "active" : ""}`}
        onMouseEnter={() => preview(name)}
        onFocus={() => preview(name)}
        onMouseLeave={restore}
        onBlur={restore}
        onClick={() => commit(name)}
      >
        <ThemeSwatch theme={name} />
        <div className="onb-theme-meta">
          <div className="onb-theme-name">{meta.label}</div>
          <div className="onb-theme-desc">{meta.description}</div>
        </div>
      </button>
    );
  };

  return (
    <div role="radiogroup" aria-label="Theme">
      {MODE_GROUPS.map(({ mode, label }) => {
        const names = themesByMode(mode);
        if (names.length === 0) return null;
        return (
          <div key={mode} className="theme-mode-group">
            <div className="theme-mode-label">{label}</div>
            <div className={className}>{names.map(card)}</div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Theme picker — hover to preview, click to commit. The preview is real:
 * we apply the theme class to ``<html>`` so the surrounding wizard
 * recolours too. Restored on unmount.
 */
export function ThemePicker({
  selected,
  onChange,
  onNext,
  onBack,
}: Props): ReactNode {
  return (
    <div className="onb-step">
      <h2 className="onb-h2">Pick a look</h2>
      <p className="onb-sub">
        Loom ships with {THEMES.length} themes. You can change this any time from
        Settings.
      </p>
      <ThemePickerGrid selected={selected} onChange={onChange} />
      <div className="onb-actions">
        <button className="btn btn-md" onClick={onBack}>
          ← Back
        </button>
        <button className="btn btn-md btn-active" onClick={onNext}>
          Next →
        </button>
      </div>
    </div>
  );
}
