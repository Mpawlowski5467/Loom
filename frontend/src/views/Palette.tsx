import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "../context/app-ctx";
import { Dot } from "../components/primitives/Dot";
import {
  recentNotes,
  searchNotesRemote,
  type SearchResult,
} from "../api/search";
import { ApiError } from "../api/client";

const SEARCH_DEBOUNCE_MS = 150;

type RemoteOutcome =
  | { kind: "ok"; query: string; results: SearchResult[] }
  | { kind: "error"; query: string };

export function Palette(): ReactNode {
  const { notes, openNote, setPaletteOpen } = useApp();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [outcome, setOutcome] = useState<RemoteOutcome | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const recent = useMemo(() => recentNotes(notes, 8), [notes]);
  const trimmed = q.trim();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!trimmed) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      void searchNotesRemote(trimmed, 10, ctrl.signal)
        .then((results) => {
          if (ctrl.signal.aborted) return;
          setOutcome({ kind: "ok", query: trimmed, results });
        })
        .catch((err) => {
          if ((err as DOMException)?.name === "AbortError") return;
          if (!(err instanceof ApiError)) {
            console.error("palette search failed", err);
          }
          setOutcome({ kind: "error", query: trimmed });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [trimmed]);

  const currentOutcome =
    outcome && outcome.query === trimmed ? outcome : null;
  const isLoading = Boolean(trimmed) && currentOutcome === null;

  const results: SearchResult[] = !trimmed
    ? recent
    : currentOutcome?.kind === "ok"
      ? currentOutcome.results
      : [];

  const footLabel = !trimmed
    ? "recent"
    : isLoading
      ? "searching…"
      : currentOutcome?.kind === "error"
        ? "offline"
        : "backend search";

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
          {isLoading && (
            <div className="palette-item" style={{ color: "var(--ink-3)" }}>
              <em>searching…</em>
            </div>
          )}
          {currentOutcome?.kind === "error" && (
            <div className="palette-item" style={{ color: "var(--ink-3)" }}>
              <em>search unavailable — backend offline</em>
            </div>
          )}
          {!isLoading &&
            currentOutcome?.kind !== "error" &&
            results.length === 0 && (
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
          <span>{footLabel}</span>
        </div>
      </div>
    </div>
  );
}
