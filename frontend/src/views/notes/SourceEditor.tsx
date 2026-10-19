import { useMemo, useRef, useState } from "react";
import type { Note } from "@/data/types";
import {
  activeWikilinkQuery,
  wikilinkSuggestions,
  wikilinkTarget,
  type WikilinkQuery,
} from "@/editor/wikilinkCompletion";
import { cn } from "@/lib/utils";

interface SourceEditorProps {
  value: string;
  notes: Note[];
  onChange: (value: string) => void;
}

/** Raw markdown editing, with keyboard-accessible `[[` completion. */
export function SourceEditor({ value, notes, onChange }: SourceEditorProps) {
  const [query, setQuery] = useState<WikilinkQuery | null>(null);
  const [index, setIndex] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const suggestions = useMemo(
    () => (query ? wikilinkSuggestions(notes, query.text) : []),
    [notes, query],
  );
  const selected = Math.min(index, Math.max(0, suggestions.length - 1));

  const choose = (note: Note) => {
    if (!query) return;
    const target = wikilinkTarget(note, notes);
    const next = `${value.slice(0, query.start)}[[${target}]]${value.slice(query.end)}`;
    const cursor = query.start + target.length + 4;
    onChange(next);
    setQuery(null);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(cursor, cursor);
    });
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        aria-label="Note body (markdown)"
        aria-autocomplete="list"
        aria-controls="wikilink-suggestions"
        aria-expanded={suggestions.length > 0}
        spellCheck={false}
        onChange={(e) => {
          onChange(e.target.value);
          setQuery(
            activeWikilinkQuery(e.target.value, e.target.selectionStart),
          );
          setIndex(0);
        }}
        onKeyDown={(e) => {
          if (!suggestions.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setIndex((i) => Math.min(i + 1, suggestions.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            choose(suggestions[selected]!);
          } else if (e.key === "Escape") setQuery(null);
        }}
        className="field-sizing-content min-h-80 w-full resize-none rounded-md border border-border bg-muted/40 p-4 font-mono text-sm leading-relaxed text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {suggestions.length > 0 && (
        <div
          id="wikilink-suggestions"
          role="listbox"
          aria-label="Wikilink suggestions"
          className="absolute z-20 mt-1 w-72 rounded-md border border-border bg-popover p-1 shadow-overlay"
        >
          {suggestions.map((note, i) => (
            <button
              key={note.id}
              type="button"
              role="option"
              aria-selected={i === selected}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(note)}
              className={cn(
                "flex w-full flex-col items-start rounded-sm px-2 py-1 text-left text-sm",
                i === selected
                  ? "bg-accent text-foreground"
                  : "text-secondary-foreground",
              )}
            >
              <span className="truncate">{note.title}</span>
              <code className="font-mono text-[11px] text-muted-foreground">
                {wikilinkTarget(note, notes)}
              </code>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
