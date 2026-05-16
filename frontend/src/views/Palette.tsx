import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "../context/app-ctx";
import { Dot } from "../components/primitives/Dot";
import { searchNotes } from "../api/search";

export function Palette(): ReactNode {
  const { notes, openNote, setPaletteOpen } = useApp();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const results = useMemo(() => searchNotes(q, notes, 10), [q, notes]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const onQueryChange = (v: string) => {
    setQ(v);
    setSel(0);
  };

  const choose = (idx: number) => {
    const r = results[idx];
    if (!r) return;
    openNote(r.note_id);
    setPaletteOpen(false);
  };

  return (
    <div
      className="palette-overlay"
      role="dialog"
      aria-modal="true"
      onClick={() => setPaletteOpen(false)}
    >
      <div
        className="palette"
        role="combobox"
        aria-expanded="true"
        aria-haspopup="listbox"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="search vault semantically…"
          value={q}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(results.length - 1, s + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(sel);
            } else if (e.key === "Escape") {
              setPaletteOpen(false);
            }
          }}
        />
        <div className="palette-list" role="listbox">
          {results.length === 0 && (
            <div className="palette-item" style={{ color: "var(--ink-3)" }}>
              <em>no matches</em>
            </div>
          )}
          {results.map((r, i) => (
            <div
              key={r.note_id}
              role="option"
              aria-selected={i === sel}
              className="palette-item"
              onMouseEnter={() => setSel(i)}
              onClick={() => choose(i)}
            >
              <div className="palette-item-h">
                <div className="palette-item-h-l">
                  <Dot type={r.type} />
                  <span className="palette-item-title">{r.title}</span>
                  {r.heading && (
                    <span className="palette-item-h2">## {r.heading}</span>
                  )}
                </div>
                <span className="palette-item-score">{r.score.toFixed(2)}</span>
              </div>
              <div className="palette-item-snippet">{r.snippet}</div>
            </div>
          ))}
        </div>
        <div className="palette-foot">
          <span>↑↓ navigate · ↵ open · esc close</span>
          <span>{q ? "semantic · LanceDB" : "recent"}</span>
        </div>
      </div>
    </div>
  );
}
