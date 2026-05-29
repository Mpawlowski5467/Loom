import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "../context/app-ctx";
import { Button } from "../components/primitives/Button";
import { Chip } from "../components/primitives/Chip";
import { Wikilink } from "../components/primitives/Wikilink";
import { AgentBlob } from "../components/primitives/AgentBlob";
import { renderMarkdown } from "../editor/renderMarkdown";
import { EditSuggestionModal } from "./EditSuggestionModal";
import { processCapture } from "../api/captures";

export function InboxView(): ReactNode {
  const {
    captures,
    selectedCaptureId,
    selectCapture,
    setCaptureStatus,
    noteById,
    pushToast,
    appendNote,
    openNote,
  } = useApp();
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const filteredCaptures = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return captures;
    return captures.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.body.toLowerCase().includes(q) ||
        c.folder.toLowerCase().includes(q),
    );
  }, [captures, search]);

  const selected = captures.find((c) => c.id === selectedCaptureId) ?? captures[0];
  const pendingCount = captures.filter((c) => c.status !== "done").length;

  const filteredIds = useMemo(
    () => filteredCaptures.map((c) => c.id),
    [filteredCaptures],
  );
  const allSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));
  const someSelected =
    !allSelected && filteredIds.some((id) => selectedIds.has(id));

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of filteredIds) next.delete(id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of filteredIds) next.add(id);
        return next;
      });
    }
  };

  const selectionCount = selectedIds.size;

  const skipSelected = () => {
    if (selectionCount === 0) return;
    selectedIds.forEach((id) => setCaptureStatus(id, "done"));
    pushToast({
      icon: "↷",
      agent: "weaver",
      body: `Skipped ${selectionCount} capture${selectionCount === 1 ? "" : "s"}`,
    });
    setSelectedIds(new Set());
  };

  const processSelected = async () => {
    if (selectionCount === 0) return;
    const targets = captures.filter((c) => selectedIds.has(c.id));
    targets.forEach((c) => setCaptureStatus(c.id, "processing"));
    pushToast({
      icon: "🧶",
      agent: "weaver",
      body: `Processing ${targets.length} capture${targets.length === 1 ? "" : "s"}`,
    });
    setSelectedIds(new Set());

    let ok = 0;
    let fail = 0;
    for (const c of targets) {
      const relPath = c.filePath
        ? c.filePath.split("/threads/")[1] ?? c.filePath
        : `${c.folder}/${c.id}.md`;
      try {
        const result = await processCapture(relPath);
        if (result.processed) {
          ok++;
          setCaptureStatus(c.id, "done");
          pushToast({
            icon: "🧶",
            agent: "weaver",
            body: `Filed "${result.note_title}" → ${result.note_type ?? "note"}`,
          });
          const linkCount = result.linked?.length ?? 0;
          const suggCount = result.suggested?.length ?? 0;
          if (linkCount + suggCount > 0) {
            pushToast({
              icon: "🕸",
              agent: "spider",
              body: `${linkCount} linked, ${suggCount} suggested`,
            });
          }
          if (result.validation) {
            const v = result.validation;
            pushToast({
              icon: v === "passed" ? "✓" : v === "warning" ? "⚠" : "✗",
              agent: "sentinel",
              body: `Validation: ${v}`,
            });
          }
        } else {
          fail++;
          setCaptureStatus(c.id, "pending");
          pushToast({
            icon: "⚠",
            agent: "weaver",
            body: `Skipped "${c.title}": ${result.error ?? "unknown error"}`,
          });
        }
      } catch (err) {
        fail++;
        setCaptureStatus(c.id, "pending");
        pushToast({
          icon: "⚠",
          agent: "weaver",
          body: `Failed "${c.title}": ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    if (targets.length > 1) {
      pushToast({
        icon: ok > 0 ? "✓" : "⚠",
        agent: "weaver",
        body: `Done — ${ok} filed, ${fail} failed`,
      });
    }
  };

  const fileCapture = useCallback(
    (capId: string) => {
      const cap = captures.find((c) => c.id === capId);
      setCaptureStatus(capId, "done");
      pushToast({
        icon: "🧶",
        agent: "weaver",
        body: `Filed ${cap?.suggestion?.title ?? "capture"} → ${cap?.suggestion?.destFolder ?? "captures"}/`,
      });
    },
    [captures, setCaptureStatus, pushToast],
  );

  // Keyboard triage: j/k move between captures, e edits the suggestion, ↵ files
  // it. Ignored while typing in a field or with the edit modal open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing) return;
      const el = e.target as HTMLElement | null;
      if (
        el?.tagName === "INPUT" ||
        el?.tagName === "TEXTAREA" ||
        el?.isContentEditable
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!["j", "k", "e", "Enter"].includes(e.key)) return;
      const idx = filteredCaptures.findIndex((c) => c.id === selected?.id);
      const actionable =
        !!selected &&
        selected.status !== "done" &&
        selected.status !== "processing" &&
        !!selected.suggestion;
      if (e.key === "j") {
        e.preventDefault();
        const n = filteredCaptures[Math.min(filteredCaptures.length - 1, idx + 1)];
        if (n) selectCapture(n.id);
      } else if (e.key === "k") {
        e.preventDefault();
        const p = filteredCaptures[Math.max(0, idx - 1)];
        if (p) selectCapture(p.id);
      } else if (e.key === "e" && actionable) {
        e.preventDefault();
        setEditing(true);
      } else if (e.key === "Enter" && actionable) {
        e.preventDefault();
        fileCapture(selected.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filteredCaptures, selected, editing, selectCapture, fileCapture]);

  return (
    <div className="inbox-view">
      <div className="inbox-list">
        <div className="inbox-toolbar">
          <span className="inbox-title">
            Captures
            <span className="inbox-count">{pendingCount}</span>
          </span>
        </div>
        <div className="inbox-search-row">
          <input
            type="search"
            className="inbox-search"
            placeholder="Search captures…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search captures"
          />
        </div>
        <div className="inbox-bulk-row">
          <label className="inbox-bulk-check">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = someSelected;
              }}
              onChange={toggleAll}
              disabled={filteredIds.length === 0}
              aria-label="Select all"
            />
            <span>
              {selectionCount > 0
                ? `${selectionCount} selected`
                : `${filteredIds.length} of ${captures.length}`}
            </span>
          </label>
          <div className="inbox-bulk-actions">
            <Button
              size="sm"
              onClick={skipSelected}
              disabled={selectionCount === 0}
            >
              Skip
            </Button>
            <Button
              variant="amber"
              size="sm"
              onClick={processSelected}
              disabled={selectionCount === 0}
            >
              Process
            </Button>
          </div>
        </div>
        <div className="inbox-scroll">
          {filteredCaptures.length === 0 && (
            <div className="inbox-empty">No matching captures</div>
          )}
          {filteredCaptures.map((c) => {
            const isActive = selected?.id === c.id;
            const filed = c.status === "done";
            const isChecked = selectedIds.has(c.id);
            return (
              <div
                key={c.id}
                className="inbox-card"
                role="button"
                tabIndex={0}
                aria-current={isActive}
                onClick={() => selectCapture(c.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectCapture(c.id);
                  }
                }}
              >
                <input
                  type="checkbox"
                  className="inbox-card-check"
                  checked={isChecked}
                  onChange={() => toggleOne(c.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Select ${c.title}`}
                />
                <div className="inbox-card-body">
                  <div className="inbox-card-h">
                    <span className="inbox-card-title">{c.title}</span>
                    {!filed && (
                      <span
                        className="status-badge"
                        data-state={c.status === "processing" ? "running" : "queued"}
                      >
                        <span className="pulse-dot" />
                        {c.status}
                      </span>
                    )}
                  </div>
                  <div className="inbox-card-meta">
                    <span>{c.folder}/</span>
                    <span>·</span>
                    <span>{c.receivedAt.slice(11, 16)} · {c.receivedAt.slice(5, 10)}</span>
                  </div>
                  {filed && c.filedAs && noteById(c.filedAs) && (
                    <div className="inbox-card-filed">
                      filed as <Wikilink target={noteById(c.filedAs)!.title} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selected && (
        <div className="inbox-detail">
          <div className="inbox-detail-title">{selected.title}</div>
          <div className="inbox-detail-meta">
            <span>{selected.folder}/</span>
            <span>received {selected.receivedAt.slice(5, 16).replace("T", " ")}</span>
          </div>
          {renderMarkdown(selected.body, { bodyClass: "inbox-detail-body" })}

          {selected.status === "processing" && (
            <div className="inbox-processing" role="status" aria-live="polite">
              <div className="inbox-suggest-h">
                <AgentBlob agent="weaver" state="running" size={22} />
                Weaver is filing this capture…
              </div>
              <div className="inbox-skeleton" aria-hidden="true">
                <span className="sk-line" />
                <span className="sk-line short" />
                <span className="sk-line" />
              </div>
            </div>
          )}
          {selected.status !== "done" &&
            selected.status !== "processing" &&
            selected.suggestion && (
            <div className="inbox-suggest">
              <div className="inbox-suggest-h">
                <AgentBlob agent="weaver" state="running" size={22} />
                Weaver suggestion
              </div>
              <div className="inbox-suggest-row">
                <span className="label">type</span>
                <Chip type={selected.suggestion.type}>{selected.suggestion.type}</Chip>
                <span className="label" style={{ marginLeft: 8 }}>folder</span>
                <Chip>{selected.suggestion.destFolder}/</Chip>
                <span className="label" style={{ marginLeft: 8 }}>title</span>
                <span style={{ fontFamily: "var(--serif)", fontStyle: "italic" }}>
                  {selected.suggestion.title}
                </span>
              </div>
              <div className="inbox-suggest-row">
                <span className="label">tags</span>
                {selected.suggestion.tags.map((t) => (
                  <Chip key={t}>#{t}</Chip>
                ))}
              </div>
              <div className="inbox-suggest-row">
                <span className="label">links</span>
                {selected.suggestion.links.map((id) => {
                  const n = noteById(id);
                  if (!n) return null;
                  return <Wikilink key={id} target={n.title} />;
                })}
              </div>
              <div className="inbox-suggest-actions">
                <Button
                  variant="amber"
                  size="md"
                  onClick={() => fileCapture(selected.id)}
                >
                  accept & file
                </Button>
                <Button onClick={() => setEditing(true)}>edit suggestion</Button>
                <Button onClick={() => setCaptureStatus(selected.id, "done")}>skip</Button>
                <span className="inbox-kbd-hint">j/k move · e edit · ↵ file</span>
              </div>
            </div>
          )}
          {selected.status === "done" && (
            <div className="inbox-suggest" style={{ borderColor: "var(--green)", background: "var(--green-bg)" }}>
              <div className="inbox-suggest-h" style={{ color: "var(--green)" }}>
                ✓ filed
              </div>
              <div style={{ fontFamily: "var(--serif)", fontSize: 13.5, color: "var(--ink-2)" }}>
                This capture has been processed.
              </div>
            </div>
          )}
        </div>
      )}

      {editing && selected && (
        <EditSuggestionModal
          capture={selected}
          onClose={() => setEditing(false)}
          onAccepted={(note, record) => {
            appendNote(note);
            setCaptureStatus(selected.id, "done");
            pushToast({
              icon: "🧶",
              agent: "weaver",
              body: `Filed [[${record.title}]] → ${
                record.file_path.split("/threads/")[1] ?? record.file_path
              }`,
            });
            openNote(note.id);
          }}
        />
      )}
    </div>
  );
}
