import type { ReactNode } from "react";

const GLYPHS = [
  "✦",
  "✧",
  "◆",
  "●",
  "▲",
  "■",
  "✳",
  "☾",
  "⚙",
  "✎",
  "⚡",
  "❖",
] as const;

interface IconPickerProps {
  value: string;
  onChange: (icon: string) => void;
}

/**
 * Agent icon input: a grid of suggested glyphs (toggle buttons) plus a
 * free-text field for anything else — picking a glyph and typing stay in sync
 * because both drive the same value.
 */
export function IconPicker({ value, onChange }: IconPickerProps): ReactNode {
  return (
    <div className="icon-picker">
      <div className="icon-picker-grid" role="group" aria-label="Suggested icons">
        {GLYPHS.map((glyph) => (
          <button
            key={glyph}
            type="button"
            className={`icon-picker-glyph${value === glyph ? " is-selected" : ""}`}
            aria-pressed={value === glyph}
            aria-label={`Icon ${glyph}`}
            onClick={() => onChange(glyph)}
          >
            {glyph}
          </button>
        ))}
      </div>
      <input
        className="input mono icon-picker-input"
        aria-label="Custom icon"
        value={value}
        maxLength={4}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
