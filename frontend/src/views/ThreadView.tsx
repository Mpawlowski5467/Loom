import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "../context/app-ctx";
import { Button } from "../components/primitives/Button";
import { Chip } from "../components/primitives/Chip";
import { Dot } from "../components/primitives/Dot";
import { Wikilink } from "../components/primitives/Wikilink";
import { Sidebar } from "../components/layout/Sidebar";
import { MiniGraph } from "../components/sidebar/MiniGraph";
import { extractHeadings, renderMarkdown } from "../editor/renderMarkdown";
import {
  archiveNote as apiArchiveNote,
  backendNoteToFrontend,
  titleMapFromNotes,
  updateNote as apiUpdateNote,
} from "../api/notes";
import { Trash2 } from "lucide-react";

export function ThreadView(): ReactNode {
  const {
    currentNoteId,
    notes,
    noteById,
    backlinksFor,
    primaryOpen,
    secondaryOpen,
    setPrimaryOpen,
    setSecondaryOpen,
    editing,
    setEditing,
    openNote,
    updateNote,
    removeNote,
    pushToast,
    setTab,
  } = useApp();
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  const note = currentNoteId ? noteById(currentNoteId) ?? null : null;
  const [draft, setDraft] = useState<string>(note?.body ?? "");
  const [saving, setSaving] = useState(false);

  const dirty = !!note && draft !== note.body;
  const canSave = dirty && !saving;

  // Keep latest draft/editing readable from the note-switch guard below.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const prevNoteRef = useRef<{ id: string; title: string; body: string } | null>(
    note ? { id: note.id, title: note.title, body: note.body } : null,
  );

  // Re-seed the editor when the open note changes; guard unsaved edits so
  // switching notes mid-edit can't silently discard work.
  useLayoutEffect(() => {
    const prev = prevNoteRef.current;
    const switched = (prev?.id ?? null) !== (note?.id ?? null);
    if (
      switched &&
      prev &&
      editingRef.current &&
      draftRef.current !== prev.body &&
      !window.confirm(`Discard unsaved changes in "${prev.title}"?`)
    ) {
      openNote(prev.id); // revert navigation, keep the in-progress draft
      return;
    }
    prevNoteRef.current = note
      ? { id: note.id, title: note.title, body: note.body }
      : null;
    if (switched) setDraft(note?.body ?? "");
  }, [currentNoteId, note, openNote]);

  const save = async () => {
    if (!note || !canSave) return;
    setSaving(true);
    try {
      const record = await apiUpdateNote(note.id, { body: draft });
      updateNote(backendNoteToFrontend(record, titleMapFromNotes(notes)));
      pushToast({
        icon: "✓",
        agent: "weaver",
        body: `Saved [[${record.title}]]`,
      });
      setEditing(false);
    } catch (err) {
      pushToast({
        icon: "⚠",
        agent: "sentinel",
        body: `Save failed: ${err instanceof Error ? err.message : "unknown error"}`,
      });
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!note) {
    return (
      <div className="thread-view">
        <div className="thread-main">
          <div className="thread-empty">
            No note selected. Open one from the file tree or graph.
          </div>
        </div>
      </div>
    );
  }

  const beginTitleEdit = () => {
    setTitleDraft(note.title);
    setEditingTitle(true);
  };

  const saveTitle = async () => {
    const next = titleDraft.trim();
    if (!next || next === note.title) {
      setEditingTitle(false);
      return;
    }
    try {
      const record = await apiUpdateNote(note.id, { title: next });
      updateNote(backendNoteToFrontend(record, titleMapFromNotes(notes)));
      pushToast({
        icon: "✎",
        agent: "weaver",
        body: `Renamed to [[${record.title}]]`,
      });
      setEditingTitle(false);
    } catch (err) {
      pushToast({
        icon: "⚠",
        agent: "sentinel",
        body: err instanceof Error ? err.message : "Rename failed",
      });
    }
  };

  const deleteNote = async () => {
    const ok = window.confirm(
      `Archive "${note.title}"? It moves to threads/.archive/.`,
    );
    if (!ok) return;
    try {
      await apiArchiveNote(note.id);
      removeNote(note.id);
      pushToast({
        icon: "📦",
        agent: "archivist",
        body: `Archived [[${note.title}]]`,
      });
      setTab("graph");
    } catch (err) {
      pushToast({
        icon: "⚠",
        agent: "sentinel",
        body: err instanceof Error ? err.message : "Archive failed",
      });
    }
  };

  const headings = extractHeadings(note.body);
  const back = backlinksFor(note.id);
  const related = Array.from(new Set([...note.links, ...back])).slice(0, 6);

  return (
    <div className="thread-view">
      <div className="thread-main">
        <header className="thread-header">
          {editingTitle ? (
            <input
              className="thread-title-input"
              value={titleDraft}
              autoFocus
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => void saveTitle()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void saveTitle();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setEditingTitle(false);
                }
              }}
              aria-label="Note title"
            />
          ) : (
            <h1
              className="thread-title"
              onClick={beginTitleEdit}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter") beginTitleEdit();
              }}
              title="Click to rename"
            >
              {note.title}
            </h1>
          )}
          <div className="thread-meta">
            <Chip type={note.type}>{note.type}</Chip>
            {note.tags.map((t) => (
              <Chip key={t}>#{t}</Chip>
            ))}
            <span className="spacer" />
            <span>modified {note.modified.slice(0, 10)}</span>
            <Button
              variant={editing ? "active" : "default"}
              onClick={() => setEditing(!editing)}
              aria-pressed={editing}
            >
              ✎ edit
            </Button>
            <Button
              onClick={() => void deleteNote()}
              aria-label="Archive note"
              title="Archive note"
            >
              <Trash2 size={13} aria-hidden="true" />
            </Button>
            <Button
              variant={primaryOpen ? "active" : "default"}
              onClick={() => setPrimaryOpen(!primaryOpen)}
              aria-pressed={primaryOpen}
            >
              ▤ details
            </Button>
            <Button
              variant={secondaryOpen ? "active" : "default"}
              onClick={() => setSecondaryOpen(!secondaryOpen)}
              aria-pressed={secondaryOpen}
              disabled={editing}
            >
              ⊞ context
            </Button>
          </div>
        </header>

        {editing ? (
          <div className="editor-split">
            <div className="editor-source">
              <div className="editor-pane-h">
                SOURCE · MARKDOWN
                <span className="spacer" />
                <Button
                  variant="active"
                  size="sm"
                  onClick={() => void save()}
                  disabled={!canSave}
                  aria-label="Save note (⌘S)"
                  title="⌘S"
                >
                  {saving ? "saving…" : "save"}
                </Button>
              </div>
              <textarea
                className="editor-textarea"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
              />
            </div>
            <div className="editor-preview">
              <div className="editor-pane-h">PREVIEW · RENDERED</div>
              {renderMarkdown(draft, {
                bodyClass: "thread-body editor-preview-body",
              })}
            </div>
          </div>
        ) : (
          renderMarkdown(note.body, { bodyClass: "thread-body" })
        )}
      </div>

      {primaryOpen && (
        <Sidebar
          title="Details"
          onClose={() => setPrimaryOpen(false)}
          editing={editing}
        >
          <div className="sidebar-section">
            <h4>
              <span>Edit history</span>
              <span className="count">{note.history.length}</span>
            </h4>
            {note.history
              .slice()
              .reverse()
              .map((h, i) => {
                const isYou = h.by === "you";
                const actor = isYou
                  ? "YOU"
                  : h.by.replace("agent:", "").toUpperCase();
                const when = h.at.slice(5, 10) + " " + h.at.slice(11, 16);
                return (
                  <div key={i} className="history-entry">
                    <span
                      className={`history-dot ${isYou ? "you" : "agent"}`}
                    />
                    <span className="history-when">{when}</span>
                    <span>
                      <span className="history-actor">{actor}</span>{" "}
                      {h.action}
                      {h.reason ? ` — ${h.reason}` : ""}
                    </span>
                  </div>
                );
              })}
          </div>

          <div className="sidebar-section">
            <h4>
              <span>Backlinks</span>
              <span className="count">{back.length}</span>
            </h4>
            {back.length === 0 && (
              <em className="muted" style={{ fontSize: 12 }}>
                no backlinks yet
              </em>
            )}
            {back.map((id) => {
              const n = noteById(id);
              if (!n) return null;
              return <Wikilink key={id} target={n.title} block />;
            })}
          </div>

          <div className="sidebar-section">
            <h4>
              <span>Tags</span>
              <span className="count">{note.tags.length}</span>
            </h4>
            <div className="tag-row">
              {note.tags.map((t) => (
                <Chip key={t}>#{t}</Chip>
              ))}
            </div>
          </div>
        </Sidebar>
      )}

      {secondaryOpen && !editing && (
        <Sidebar
          title="Context"
          secondary
          onClose={() => setSecondaryOpen(false)}
        >
          <div className="sidebar-section">
            <h4>
              <span>Local graph</span>
              <span className="count">1 hop</span>
            </h4>
            <MiniGraph focusId={note.id} />
          </div>

          <div className="sidebar-section">
            <h4>
              <span>Outline</span>
              <span className="count">{headings.length}</span>
            </h4>
            {headings.length === 0 && (
              <em className="muted" style={{ fontSize: 12 }}>
                no headings
              </em>
            )}
            {headings.map((h) => (
              <button
                key={h.id}
                className="outline-row"
                style={{ paddingLeft: 4 + (h.depth - 1) * 12 }}
                onClick={() =>
                  document
                    .getElementById(h.id)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
              >
                <span className="marker">§</span>
                <span>{h.text}</span>
              </button>
            ))}
          </div>

          <div className="sidebar-section">
            <h4>
              <span>Related</span>
              <span className="count">{related.length}</span>
            </h4>
            {related.map((id) => {
              const n = noteById(id);
              if (!n) return null;
              return (
                <button
                  key={id}
                  className="related-row"
                  onClick={() => openNote(n.id)}
                >
                  <Dot type={n.type} />
                  <span>{n.title}</span>
                </button>
              );
            })}
          </div>
        </Sidebar>
      )}
    </div>
  );
}
