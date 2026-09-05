import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useApp } from "../context/app-ctx";
import { Button } from "../components/primitives/Button";
import { Chip } from "../components/primitives/Chip";
import { Dot } from "../components/primitives/Dot";
import { Wikilink } from "../components/primitives/Wikilink";
import { Sidebar } from "../components/layout/Sidebar";
import { MiniGraph } from "../components/sidebar/MiniGraph";
import { extractHeadings, renderMarkdown } from "../editor/renderMarkdown";
import { NoteAnchorScroll } from "../editor/NoteAnchorScroll";
import { ThreadEditor, type EditorConflict } from "../editor/ThreadEditor";
import {
  archiveNote as apiArchiveNote,
  backendNoteToFrontend,
  getNote,
  titleMapFromNotes,
  updateNote as apiUpdateNote,
} from "../api/notes";
import { ApiError } from "../api/client";
import {
  readNoteDraft,
  removeNoteDraft,
  writeNoteDraft,
} from "../editor/noteDraftStorage";
import { ConfirmModal } from "../components/ConfirmModal";
import { RevisionHistory } from "../components/RevisionHistory";
import { ConnectionEvidence } from "../components/ConnectionEvidence";
import { SourceCapture } from "../components/SourceCapture";
import { formatDate, formatDateTime } from "../data/formatDate";
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
    config,
    reloadNoteBody,
  } = useApp();
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  // Accessible confirm dialogs (replace window.confirm).
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [pendingDiscard, setPendingDiscard] = useState<{
    fromTitle: string;
    toId: string;
  } | null>(null);

  const note = currentNoteId ? (noteById(currentNoteId) ?? null) : null;
  const [draft, setDraft] = useState<string>(note?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const [showDiscardDraft, setShowDiscardDraft] = useState(false);
  const [showOverwrite, setShowOverwrite] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [conflict, setConflict] = useState<EditorConflict | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [editingTags, setEditingTags] = useState(false);
  const [savingTags, setSavingTags] = useState(false);
  // Version snapshots must stay paired with the text the user saw when an
  // action began. Reading live ``note.modified`` at submit time could bless a
  // newer SSE-delivered agent edit while sending an older local draft.
  const draftBaseModifiedRef = useRef(note?.modified ?? "");
  const titleBaseModifiedRef = useRef(note?.modified ?? "");
  const archiveBaseModifiedRef = useRef(note?.modified ?? "");
  const vaultId = config?.active_vault ?? "default";
  // Layout effects replay in development StrictMode before a queued state
  // update reaches ``draftRef``. Track an accepted local recovery separately
  // so that replay cannot replace it with the remote body in that small gap.
  const protectedDraftRef = useRef<{ vaultId: string; noteId: string } | null>(
    null,
  );
  const noteBodyLoaded =
    !note ||
    !("bodyLoaded" in note) ||
    (note as typeof note & { bodyLoaded?: boolean }).bodyLoaded !== false;

  const dirty = !!note && noteBodyLoaded && draft !== note.body;
  const canSave = dirty && !saving;

  // The textarea binds to `draft` (immediate), but the live preview renders a
  // deferred copy: on a long/code-heavy note React can interrupt the full
  // markdown re-parse so typing stays responsive. Memoize so identical text
  // doesn't re-render the pipeline on unrelated state changes.
  const deferredDraft = useDeferredValue(draft);
  const preview = useMemo(
    () =>
      renderMarkdown(deferredDraft, {
        bodyClass: "thread-body editor-preview-body",
      }),
    [deferredDraft],
  );

  // Keep latest draft/editing readable from the note-switch guard below.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const prevNoteRef = useRef<{
    id: string;
    title: string;
    body: string;
  } | null>(null);
  const prevVaultRef = useRef(vaultId);
  const previousBodyLoadedRef = useRef(noteBodyLoaded);
  // Set while the user is intentionally discarding (confirmed) so the guard
  // below lets that one switch through instead of re-prompting.
  const discardingRef = useRef(false);

  const persistDraft = useCallback(
    (next: string, baseModified = draftBaseModifiedRef.current) => {
      if (!note || !noteBodyLoaded) return;
      if (next === note.body) {
        removeNoteDraft(vaultId, note.id);
        setStorageFailed(false);
        return;
      }
      const saved = writeNoteDraft(vaultId, note.id, {
        body: next,
        baseModified,
        savedAt: new Date().toISOString(),
      });
      setStorageFailed(!saved);
    },
    [note, noteBodyLoaded, vaultId],
  );

  const changeDraft = useCallback(
    (next: string) => {
      protectedDraftRef.current =
        note && next !== note.body ? { vaultId, noteId: note.id } : null;
      setDraft(next);
      persistDraft(next);
    },
    [note, persistDraft, vaultId],
  );

  // If local persistence becomes unavailable, warn before the browser tears
  // down the only remaining copy of the user's changes.
  useEffect(() => {
    if (!storageFailed || !dirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty, storageFailed]);

  // Re-seed the editor when the open note changes; guard unsaved edits so
  // switching notes mid-edit can't silently discard work. The confirmation is
  // a state-driven accessible modal (see ConfirmModal below): on an unsaved
  // switch we revert to ``prev`` and stash the target in ``pendingDiscard``;
  // confirming there re-navigates with the guard bypassed.
  useLayoutEffect(() => {
    const prev = prevNoteRef.current;
    const vaultChanged = prevVaultRef.current !== vaultId;
    const bodyBecameLoaded = !previousBodyLoadedRef.current && noteBodyLoaded;
    const switched =
      vaultChanged ||
      bodyBecameLoaded ||
      (prev?.id ?? null) !== (note?.id ?? null);
    const draftWasDirty = !!prev && draftRef.current !== prev.body;
    if (
      switched &&
      prev &&
      !vaultChanged &&
      !discardingRef.current &&
      editingRef.current &&
      draftWasDirty
    ) {
      setPendingDiscard({ fromTitle: prev.title, toId: note?.id ?? prev.id });
      openNote(prev.id); // revert navigation, keep the in-progress draft
      return;
    }
    discardingRef.current = false;
    prevVaultRef.current = vaultId;
    previousBodyLoadedRef.current = noteBodyLoaded;
    prevNoteRef.current = note
      ? { id: note.id, title: note.title, body: note.body }
      : null;
    if (switched && note && noteBodyLoaded) {
      const recovered = readNoteDraft(vaultId, note.id);
      const nextDraft = recovered?.body ?? note.body;
      protectedDraftRef.current = recovered
        ? { vaultId, noteId: note.id }
        : null;
      const baseModified =
        recovered?.baseModified ?? note.contentVersion ?? note.modified;
      setDraft(nextDraft);
      draftBaseModifiedRef.current = baseModified;
      setStorageFailed(false);
      setConflict(
        recovered && baseModified !== (note.contentVersion ?? note.modified)
          ? {
              remoteBody: note.body,
              remoteModified: note.modified,
              message:
                "Recovered draft is based on an older version. Review it before saving.",
            }
          : null,
      );
    } else if (
      (!editingRef.current || !draftWasDirty) &&
      note &&
      (protectedDraftRef.current?.vaultId !== vaultId ||
        protectedDraftRef.current?.noteId !== note.id)
    ) {
      // Keep the dormant editor paired with same-note SSE refreshes. Once an
      // edit is in progress, both draft and base version remain frozen.
      setDraft(note.body);
      draftBaseModifiedRef.current = note.contentVersion ?? note.modified;
      setConflict(null);
    }
  }, [currentNoteId, note, noteBodyLoaded, openNote, vaultId]);

  // An incoming refresh must never replace a dirty local draft. Surface the
  // version mismatch instead, so the save path remains deliberate.
  useEffect(() => {
    if (
      note &&
      dirty &&
      draftBaseModifiedRef.current !== (note.contentVersion ?? note.modified) &&
      !conflict
    ) {
      setConflict({
        remoteBody: note.body,
        remoteModified: note.modified,
        message:
          "This note changed while you were editing. Your draft is safe.",
      });
    }
  }, [conflict, dirty, note]);

  const save = useCallback(
    async (overwrite = false) => {
      if (!note || !canSave) return;
      setSaving(true);
      try {
        const record = await apiUpdateNote(note.id, {
          body: draft,
          ...(overwrite ? {} : { base_modified: draftBaseModifiedRef.current }),
        });
        draftBaseModifiedRef.current =
          record.content_version ?? record.modified;
        titleBaseModifiedRef.current =
          record.content_version ?? record.modified;
        setDraft(record.body);
        protectedDraftRef.current = null;
        removeNoteDraft(vaultId, note.id);
        setStorageFailed(false);
        setConflict(null);
        updateNote(backendNoteToFrontend(record, titleMapFromNotes(notes)));
        pushToast({
          icon: "✓",
          agent: "weaver",
          body: `Saved [[${record.title}]]`,
        });
        setEditing(false);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setConflict({
            remoteBody: note.body,
            remoteModified: note.modified,
            message: "Save was blocked because a newer version exists.",
          });
          pushToast({
            icon: "⚠",
            agent: "sentinel",
            body: "Version conflict: your draft was kept locally.",
          });
          return;
        }
        pushToast({
          icon: "⚠",
          agent: "sentinel",
          body: `Save failed: ${err instanceof Error ? err.message : "unknown error"}`,
        });
      } finally {
        setSaving(false);
      }
    },
    [note, canSave, draft, notes, pushToast, setEditing, updateNote, vaultId],
  );

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
  }, [editing, save]);

  // Read-path rendering is memoized on the note body so unrelated state churn
  // (sidebar toggles, hover, saving flags) doesn't re-parse the markdown —
  // mirrors the edit-preview memoization above. Headings feed only the
  // outline sidebar, so they're computed only while it's actually shown.
  const noteBody = note?.body ?? null;
  const renderedBody = useMemo(
    () =>
      noteBody === null
        ? null
        : renderMarkdown(noteBody, { bodyClass: "thread-body" }),
    [noteBody],
  );
  const outlineOpen = secondaryOpen && !editing;
  const headings = useMemo(
    () => (noteBody === null || !outlineOpen ? [] : extractHeadings(noteBody)),
    [noteBody, outlineOpen],
  );

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
    titleBaseModifiedRef.current = note.contentVersion ?? note.modified;
    setEditingTitle(true);
  };

  const toggleBodyEdit = () => {
    if (!editing) {
      const recovered = readNoteDraft(vaultId, note.id);
      if (recovered) {
        setDraft(recovered.body);
        draftBaseModifiedRef.current = recovered.baseModified;
        protectedDraftRef.current = { vaultId, noteId: note.id };
      }
    }
    setEditing(!editing);
  };

  const beginArchive = () => {
    archiveBaseModifiedRef.current = note.contentVersion ?? note.modified;
    setConfirmArchive(true);
  };

  const saveTitle = async () => {
    const next = titleDraft.trim();
    if (!next || next === note.title) {
      setEditingTitle(false);
      return;
    }
    try {
      const record = await apiUpdateNote(note.id, {
        title: next,
        base_modified: titleBaseModifiedRef.current,
      });
      titleBaseModifiedRef.current = record.content_version ?? record.modified;
      draftBaseModifiedRef.current = record.content_version ?? record.modified;
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

  const saveTags = async (nextTags: string[]) => {
    if (!note || savingTags) return;
    setSavingTags(true);
    try {
      const record = await apiUpdateNote(note.id, {
        tags: nextTags,
        base_modified: note.contentVersion ?? note.modified,
      });
      updateNote(backendNoteToFrontend(record, titleMapFromNotes(notes)));
      setTagDraft("");
      setEditingTags(false);
      pushToast({
        icon: "#",
        agent: "weaver",
        body: `Updated tags for [[${record.title}]]`,
      });
    } catch (err) {
      pushToast({
        icon: "⚠",
        agent: "sentinel",
        body: err instanceof Error ? err.message : "Could not update tags",
      });
    } finally {
      setSavingTags(false);
    }
  };

  const addTag = () => {
    const tag = tagDraft.trim().replace(/^#/, "");
    if (!tag || note.tags.includes(tag)) {
      setTagDraft("");
      return;
    }
    void saveTags([...note.tags, tag]);
  };

  const reloadRemoteDraft = async () => {
    if (!note) return;
    try {
      const record = await getNote(note.id);
      const refreshed = backendNoteToFrontend(record, titleMapFromNotes(notes));
      updateNote(refreshed);
      setDraft(record.body);
      protectedDraftRef.current = null;
      draftBaseModifiedRef.current = record.content_version ?? record.modified;
      removeNoteDraft(vaultId, note.id);
      setStorageFailed(false);
      setConflict(null);
    } catch (err) {
      pushToast({
        icon: "⚠",
        agent: "sentinel",
        body: err instanceof Error ? err.message : "Could not reload note",
      });
    }
  };

  // Archive runs after the user confirms in the modal. Errors propagate so the
  // ConfirmModal shows them inline and stays open for a retry.
  const archiveNow = async () => {
    await apiArchiveNote(note.id, archiveBaseModifiedRef.current);
    removeNote(note.id);
    pushToast({
      icon: "📦",
      agent: "archivist",
      body: `Archived [[${note.title}]]`,
    });
    setTab("graph");
  };

  const back = backlinksFor(note.id);
  const related = Array.from(new Set([...note.links, ...back])).slice(0, 6);

  return (
    <div className="thread-view">
      {noteBodyLoaded && <NoteAnchorScroll />}
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
                // Match CaptureCard: activate on Enter or Space, and
                // preventDefault so Space doesn't scroll the page.
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  beginTitleEdit();
                }
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
            <span>modified {formatDate(note.modified)}</span>
            <Button
              variant={editing ? "active" : "default"}
              onClick={toggleBodyEdit}
              aria-pressed={editing}
            >
              ✎ edit
            </Button>
            <Button
              onClick={beginArchive}
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

        <div className="thread-recovery-tools">
          <RevisionHistory
            key={`history:${vaultId}:${note.id}`}
            noteId={note.id}
            disabled={dirty || !noteBodyLoaded}
          />
          {note.source?.startsWith("capture:") && (
            <SourceCapture
              key={`source:${vaultId}:${note.id}`}
              noteId={note.id}
            />
          )}
        </div>

        {!noteBodyLoaded ? (
          <div className="thread-body-load" role="status">
            {"bodyError" in note && note.bodyError ? (
              <>
                {`Could not load this note: ${note.bodyError}`}
                {reloadNoteBody && (
                  <button
                    type="button"
                    onClick={() => void reloadNoteBody(note.id)}
                  >
                    Retry
                  </button>
                )}
              </>
            ) : (
              "Loading note…"
            )}
          </div>
        ) : editing ? (
          <div className="editor-split">
            <ThreadEditor
              draft={draft}
              notes={notes}
              saving={saving}
              canSave={canSave}
              storageFailed={storageFailed}
              conflict={conflict}
              onChange={changeDraft}
              onSave={() => void save()}
              onDiscard={() => setShowDiscardDraft(true)}
              onCompare={() => setShowComparison(true)}
              onReload={() => void reloadRemoteDraft()}
              onKeep={() =>
                conflict &&
                setConflict({
                  ...conflict,
                  message:
                    "Keeping your local draft. Saving remains version-checked.",
                })
              }
              onOverwrite={() => setShowOverwrite(true)}
            />
            <div className="editor-preview">
              <div className="editor-pane-h">PREVIEW · RENDERED</div>
              {preview}
            </div>
          </div>
        ) : (
          renderedBody
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
                const when = formatDateTime(h.at);
                return (
                  <div key={i} className="history-entry">
                    <span
                      className={`history-dot ${isYou ? "you" : "agent"}`}
                    />
                    <span className="history-when">{when}</span>
                    <span>
                      <span className="history-actor">{actor}</span> {h.action}
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
                <span className="thread-tag" key={t}>
                  <Chip>#{t}</Chip>
                  {editingTags && (
                    <button
                      type="button"
                      aria-label={`Remove tag ${t}`}
                      onClick={() =>
                        void saveTags(note.tags.filter((x) => x !== t))
                      }
                      disabled={savingTags}
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
              {editingTags ? (
                <input
                  className="thread-tag-input"
                  aria-label="Add tag"
                  value={tagDraft}
                  placeholder="tag"
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === ",") {
                      event.preventDefault();
                      addTag();
                    }
                    if (event.key === "Escape") {
                      setEditingTags(false);
                      setTagDraft("");
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="thread-tag-edit"
                  onClick={() => setEditingTags(true)}
                >
                  edit tags
                </button>
              )}
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
          <ConnectionEvidence key={`${vaultId}:${note.id}`} noteId={note.id} />
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

      {confirmArchive && (
        <ConfirmModal
          title={`Archive "${note.title}"?`}
          body="It moves to threads/.archive/ and leaves the active graph. You can restore it from there."
          confirmLabel="Archive"
          destructive
          onConfirm={archiveNow}
          onClose={() => setConfirmArchive(false)}
        />
      )}

      {pendingDiscard && (
        <ConfirmModal
          title={`Discard unsaved changes in "${pendingDiscard.fromTitle}"?`}
          body="Your in-progress edits will be lost."
          confirmLabel="Discard"
          destructive
          onConfirm={() => {
            const { toId } = pendingDiscard;
            discardingRef.current = true;
            setPendingDiscard(null);
            openNote(toId);
          }}
          onClose={() => setPendingDiscard(null)}
        />
      )}

      {showDiscardDraft && (
        <ConfirmModal
          title="Discard this saved draft?"
          body="This removes the local recovery copy and restores the current note version."
          confirmLabel="Discard draft"
          destructive
          onConfirm={() => {
            setDraft(note.body);
            protectedDraftRef.current = null;
            draftBaseModifiedRef.current = note.contentVersion ?? note.modified;
            removeNoteDraft(vaultId, note.id);
            setStorageFailed(false);
            setConflict(null);
          }}
          onClose={() => setShowDiscardDraft(false)}
        />
      )}

      {showOverwrite && conflict && (
        <ConfirmModal
          title="Overwrite the newer note version?"
          body="This replaces the remote body with your local draft."
          confirmLabel="Overwrite remote"
          destructive
          onConfirm={() => save(true)}
          onClose={() => setShowOverwrite(false)}
        />
      )}

      {showComparison && conflict && (
        <div className="settings-modal-backdrop" role="presentation">
          <div
            className="settings-modal editor-compare"
            role="dialog"
            aria-modal="true"
            aria-labelledby="editor-compare-title"
          >
            <div className="settings-kicker">Version conflict</div>
            <h2 id="editor-compare-title" className="settings-modal-title">
              Compare your draft with the newer note
            </h2>
            <div className="editor-compare-columns">
              <section>
                <h3>Your draft</h3>
                <pre>{draft}</pre>
              </section>
              <section>
                <h3>Remote version</h3>
                <pre>{conflict.remoteBody}</pre>
              </section>
            </div>
            <div className="settings-actions">
              <button
                className="btn btn-md"
                type="button"
                onClick={() => setShowComparison(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
