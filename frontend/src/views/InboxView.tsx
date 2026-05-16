import type { ReactNode } from "react";
import { useApp } from "../context/app-ctx";
import { Button } from "../components/primitives/Button";
import { Chip } from "../components/primitives/Chip";
import { Wikilink } from "../components/primitives/Wikilink";
import { renderMarkdown } from "../editor/renderMarkdown";

export function InboxView(): ReactNode {
  const {
    captures,
    selectedCaptureId,
    selectCapture,
    setCaptureStatus,
    noteById,
    pushToast,
  } = useApp();

  const selected = captures.find((c) => c.id === selectedCaptureId) ?? captures[0];
  const pendingCount = captures.filter((c) => c.status !== "done").length;

  const accept = (capId: string) => {
    setCaptureStatus(capId, "done");
    pushToast({
      icon: "🧶",
      agent: "WEAVER",
      body: `Filed ${selected?.suggestion?.title ?? "capture"} → ${selected?.suggestion?.destFolder ?? "captures"}/`,
    });
  };

  return (
    <div className="inbox-view">
      <div className="inbox-list">
        <div className="inbox-toolbar">
          <span className="inbox-title">
            Captures
            <span className="inbox-count">{pendingCount}</span>
          </span>
          <Button
            variant="purple"
            onClick={() => {
              for (const c of captures) {
                if (c.status !== "done") setCaptureStatus(c.id, "done");
              }
              pushToast({
                icon: "⚡",
                agent: "WEAVER",
                body: `Processed ${pendingCount} captures`,
              });
            }}
          >
            ⚡ process all
          </Button>
        </div>
        <div className="inbox-scroll">
          {captures.map((c) => {
            const isActive = selected?.id === c.id;
            const filed = c.status === "done";
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

          {selected.status !== "done" && selected.suggestion && (
            <div className="inbox-suggest">
              <div className="inbox-suggest-h">
                <span aria-hidden="true">🧶</span>
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
                <Button variant="amber" size="md" onClick={() => accept(selected.id)}>
                  accept & file
                </Button>
                <Button>edit suggestion</Button>
                <Button onClick={() => setCaptureStatus(selected.id, "done")}>skip</Button>
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
    </div>
  );
}
