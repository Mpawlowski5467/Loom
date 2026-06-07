import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "../context/app-ctx";
import { Dot } from "../components/primitives/Dot";
import { useFocusTrap } from "../components/useFocusTrap";
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
  const { notes, openNote, flyToNode, setPaletteOpen } = useApp();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [outcome, setOutcome] = useState<RemoteOutcome | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const recent = useMemo(() => recentNotes(notes, 8), [notes]);
  const trimmed = q.trim();

  // Trap focus within the palette and restore it to the trigger on close.
  // The input self-focuses below, so skip the hook's initial focus.
  const dialogRef = useFocusTrap<HTMLDivElement>({
    onEscape: () => setPaletteOpen(false),
    skipInitialFocus: true,
  });

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

  // Reveal in graph: fly the camera to the node instead of opening the reader.
  const reveal = (idx: number) => {
    const r = results[idx];
    if (!r) return;
    flyToNode(r.note_id);
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
        ref={dialogRef}
        className="palette"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="search vault semantically…"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-listbox"
          aria-activedescendant={
            results.length > 0 ? `palette-opt-${sel}` : undefined
          }
          aria-autocomplete="list"
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
              if (e.altKey) reveal(sel);
              else choose(sel);
            } else if (e.key === "Escape") {
              setPaletteOpen(false);
            }
          }}
        />
        <div className="palette-list" role="listbox" id="palette-listbox">
          {isLoading && (
            <div
              className="palette-item"
              style={{ color: "var(--ink-3)" }}
              role="status"
              aria-live="polite"
            >
              <em>searching…</em>
            </div>
          )}
          {currentOutcome?.kind === "error" && (
            <div
              className="palette-item"
              style={{ color: "var(--ink-3)" }}
              role="status"
              aria-live="polite"
            >
              <em>search unavailable — backend offline</em>
            </div>
          )}
          {!isLoading &&
            currentOutcome?.kind !== "error" &&
            results.length === 0 && (
              <div
                className="palette-item"
                style={{ color: "var(--ink-3)" }}
                role="status"
                aria-live="polite"
              >
                <em>no matches</em>
              </div>
            )}
          {results.map((r, i) => (
            <div
              key={r.note_id}
              id={`palette-opt-${i}`}
              role="option"
              aria-selected={i === sel}
              className="palette-item"
              onMouseEnter={() => setSel(i)}
              onClick={(e) => (e.altKey ? reveal(i) : choose(i))}
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
          <span>↑↓ navigate · ↵ open · ⌥↵ reveal · esc close</span>
          <span>{footLabel}</span>
        </div>
      </div>
    </div>
  );
}
