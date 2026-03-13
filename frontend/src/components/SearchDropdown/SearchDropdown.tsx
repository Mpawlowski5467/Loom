import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchResult } from "../../lib/api";
import { searchNotes } from "../../lib/api";
import styles from "./SearchDropdown.module.css";

const NODE_COLORS: Record<string, string> = {
  project: "#60a5fa",
  topic: "#4ade80",
  person: "#c084fc",
  daily: "#94a3b8",
  capture: "#fbbf24",
  custom: "#2dd4bf",
};

const DEBOUNCE_MS = 300;

interface SearchDropdownProps {
  onSelect: (noteId: string) => void;
}

export function SearchDropdown({ onSelect }: SearchDropdownProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searched, setSearched] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(0 as never);

  // Debounced search
  const doSearch = useCallback((q: string) => {
    if (q.length < 1) {
      setResults([]);
      setOpen(false);
      setSearched(false);
      return;
    }
    searchNotes(q)
      .then((res) => {
        setResults(res.results);
        setOpen(true);
        setSearched(true);
      })
      .catch(() => {
        setResults([]);
        setSearched(true);
      });
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(timerRef.current);
    if (!val.trim()) {
      setResults([]);
      setOpen(false);
      setSearched(false);
      return;
    }
    timerRef.current = setTimeout(() => doSearch(val.trim()), DEBOUNCE_MS);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      (e.target as HTMLInputElement).blur();
    }
  }

  function handleSelect(id: string) {
    setOpen(false);
    setQuery("");
    onSelect(id);
  }

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <input
        className="nav-search"
        type="text"
        placeholder="Search vault..."
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (results.length > 0) setOpen(true);
        }}
      />

      {open && (
        <div className={styles.dropdown}>
          {results.length === 0 && searched && (
            <div className={styles.empty}>No results found</div>
          )}
          {results.map((r) => (
            <div
              key={r.id}
              className={styles.item}
              onClick={() => handleSelect(r.id)}
            >
              <div className={styles.itemTop}>
                <span
                  className={styles.dot}
                  style={{
                    backgroundColor: NODE_COLORS[r.type] ?? "#94a3b8",
                  }}
                />
                <span className={styles.itemTitle}>{r.title}</span>
                <div className={styles.itemTags}>
                  {r.tags.slice(0, 3).map((t) => (
                    <span key={t} className={styles.tag}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
              {r.snippet && <div className={styles.snippet}>{r.snippet}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
