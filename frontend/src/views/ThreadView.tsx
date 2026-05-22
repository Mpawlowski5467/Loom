import { useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "../context/app-ctx";
import { Button } from "../components/primitives/Button";
import { Chip } from "../components/primitives/Chip";
import { Dot } from "../components/primitives/Dot";
import { Wikilink } from "../components/primitives/Wikilink";
import { Sidebar } from "../components/layout/Sidebar";
import { MiniGraph } from "../components/sidebar/MiniGraph";
import { extractHeadings, renderMarkdown } from "../editor/renderMarkdown";

export function ThreadView(): ReactNode {
  const {
    currentNoteId,
    noteById,
    backlinksFor,
    primaryOpen,
    secondaryOpen,
    setPrimaryOpen,
    setSecondaryOpen,
    editing,
    setEditing,
    openNote,
  } = useApp();

  const note = currentNoteId ? noteById(currentNoteId) ?? null : null;
  const [draft, setDraft] = useState<string>(note?.body ?? "");
  const [lastSeed, setLastSeed] = useState<string | null>(note?.id ?? null);
  if ((note?.id ?? null) !== lastSeed) {
    setLastSeed(note?.id ?? null);
    setDraft(note?.body ?? "");
  }

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

  const headings = extractHeadings(note.body);
  const back = backlinksFor(note.id);
  const related = Array.from(new Set([...note.links, ...back])).slice(0, 6);

  return (
    <div className="thread-view">
      <div className="thread-main">
        <header className="thread-header">
          <h1 className="thread-title">{note.title}</h1>
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
              <div className="editor-pane-h">SOURCE · MARKDOWN</div>
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
            {headings.map((h, i) => (
              <button key={i} className="outline-row">
                <span className="marker">§</span>
                <span>{h}</span>
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
