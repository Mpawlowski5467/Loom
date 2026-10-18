import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Note } from "../data/types";
import { linkTarget, noteLinkKeys } from "../data/wikilinks";
import { Button } from "../components/primitives/Button";

export interface EditorConflict {
  remoteBody: string;
  remoteModified: string;
  message: string;
}

interface WikilinkQuery {
  start: number;
  end: number;
  text: string;
}

interface ThreadEditorProps {
  draft: string;
  notes: Note[];
  saving: boolean;
  canSave: boolean;
  storageFailed: boolean;
  conflict: EditorConflict | null;
  onChange: (value: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  onCompare: () => void;
  onReload: () => void;
  onKeep: () => void;
  onOverwrite: () => void;
}

function activeWikilinkQuery(
  value: string,
  cursor: number,
): WikilinkQuery | null {
  const prefix = value.slice(0, cursor);
  const start = prefix.lastIndexOf("[[");
  if (start === -1 || prefix.slice(start + 2).includes("]]")) return null;
  const text = prefix.slice(start + 2);
  return text.includes("\n") || text.includes("|")
    ? null
    : { start, end: cursor, text };
}

function wikilinkTarget(note: Note, notes: Note[]): string {
  const slug = (note.filename ?? note.title).replace(/\.md$/i, "");
  const matches = notes.filter((candidate) =>
    noteLinkKeys(candidate).includes(linkTarget(slug)),
  );
  return matches.length === 1 ? slug : `${note.folder}/${slug}`;
}

/** Source pane, conflict actions, and keyboard-accessible wikilink completion. */
export function ThreadEditor({
  draft,
  notes,
  saving,
  canSave,
  storageFailed,
  conflict,
  onChange,
  onSave,
  onDiscard,
  onCompare,
  onReload,
  onKeep,
  onOverwrite,
}: ThreadEditorProps): ReactNode {
  const [query, setQuery] = useState<WikilinkQuery | null>(null);
  const [index, setIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestions = useMemo(() => {
    if (!query) return [];
    const text = linkTarget(query.text);
    return notes
      .filter(
        (candidate) =>
          !text || noteLinkKeys(candidate).some((key) => key.includes(text)),
      )
      .slice(0, 8);
  }, [notes, query]);

  const selectedIndex = Math.min(index, Math.max(0, suggestions.length - 1));

  const choose = useCallback(
    (candidate: Note) => {
      if (!query) return;
      const target = wikilinkTarget(candidate, notes);
      const next = `${draft.slice(0, query.start)}[[${target}]]${draft.slice(query.end)}`;
      const cursor = query.start + target.length + 4;
      onChange(next);
      setQuery(null);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(cursor, cursor);
      });
    },
    [draft, notes, onChange, query],
  );

  return (
    <div className="editor-source">
      <div className="editor-pane-h">
        SOURCE · MARKDOWN
        <span className="spacer" />
        <Button
          variant="active"
          size="sm"
          onClick={onSave}
          disabled={!canSave}
          aria-label="Save note (⌘S)"
          title="⌘S"
        >
          {saving ? "saving…" : "save"}
        </Button>
        <Button size="sm" onClick={onDiscard} disabled={!canSave}>
          discard draft
        </Button>
      </div>
      {storageFailed && (
        <div className="editor-draft-warning" role="alert">
          This browser could not save your draft locally. Keep this tab open
          until you save it.
        </div>
      )}
      {conflict && (
        <div className="editor-conflict" role="status">
          <span>{conflict.message}</span>
          <div className="editor-conflict-actions">
            <button type="button" onClick={onCompare}>
              Compare versions
            </button>
            <button type="button" onClick={onReload}>
              Reload remote
            </button>
            <button type="button" onClick={onKeep}>
              Keep draft
            </button>
            <button type="button" onClick={onOverwrite}>
              Overwrite remote
            </button>
          </div>
        </div>
      )}
      <textarea
        ref={textareaRef}
        className="editor-textarea"
        value={draft}
        onChange={(event) => {
          onChange(event.target.value);
          setQuery(
            activeWikilinkQuery(
              event.target.value,
              event.target.selectionStart,
            ),
          );
          setIndex(0);
        }}
        onKeyDown={(event) => {
          if (!suggestions.length) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setIndex((value) => Math.min(value + 1, suggestions.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setIndex((value) => Math.max(value - 1, 0));
          } else if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            choose(suggestions[selectedIndex]!);
          } else if (event.key === "Escape") setQuery(null);
        }}
        spellCheck={false}
        aria-label="Note body"
        aria-autocomplete="list"
        aria-controls="wikilink-suggestions"
        aria-expanded={suggestions.length > 0}
      />
      {suggestions.length > 0 && (
        <div
          id="wikilink-suggestions"
          className="wikilink-suggestions"
          role="listbox"
          aria-label="Wikilink suggestions"
        >
          {suggestions.map((candidate, candidateIndex) => {
            const target = wikilinkTarget(candidate, notes);
            return (
              <button
                key={candidate.id}
                type="button"
                role="option"
                aria-selected={candidateIndex === selectedIndex}
                className={candidateIndex === selectedIndex ? "selected" : ""}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(candidate)}
              >
                <span>{candidate.title}</span>
                <code>{target}</code>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
