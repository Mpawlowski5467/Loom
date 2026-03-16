import { useMemo } from "react";
import Markdown from "react-markdown";
import type { Note, VaultGraph } from "../../lib/api";
import { NODE_COLORS_CSS, formatTime } from "../../lib/constants";
import styles from "./ThreadView.module.css";

interface ThreadViewProps {
  note: Note;
  graph: VaultGraph | null;
  onNavigate: (noteTitle: string) => void;
}

function renderBodyWithWikilinks(
  body: string,
  onNavigate: (title: string) => void,
) {
  // Split on [[...]] and render wikilinks as clickable spans
  const parts = body.split(/(\[\[[^\]]+\]\])/g);
  return parts.map((part, i) => {
    const match = part.match(/^\[\[([^\]]+)\]\]$/);
    if (match) {
      const title = match[1];
      return (
        <span
          key={i}
          className={styles.wikilink}
          onClick={() => onNavigate(title)}
        >
          {title}
        </span>
      );
    }
    // Render non-wikilink markdown
    return <Markdown key={i}>{part}</Markdown>;
  });
}

export function ThreadView({ note, graph, onNavigate }: ThreadViewProps) {
  // Compute backlinks from graph data
  const backlinks = useMemo(() => {
    if (!graph) return [];
    const incoming: string[] = [];
    for (const edge of graph.edges) {
      if (edge.target === note.id && edge.source !== note.id) {
        const src = graph.nodes.find((n) => n.id === edge.source);
        if (src) incoming.push(src.title);
      }
    }
    return [...new Set(incoming)];
  }, [graph, note.id]);

  return (
    <>
      {/* Meta */}
      <div className={styles.meta}>
        <span
          className={styles.typeBadge}
          style={{ backgroundColor: NODE_COLORS_CSS[note.type] ?? "#94a3b8" }}
        >
          {note.type}
        </span>
        {note.tags.map((tag) => (
          <span key={tag} className={styles.tagChip}>
            {tag}
          </span>
        ))}
      </div>

      {/* Body with wikilinks */}
      <div className={styles.markdownBody}>
        {renderBodyWithWikilinks(note.body, onNavigate)}
      </div>

      {/* Backlinks */}
      {backlinks.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Backlinks</div>
          {backlinks.map((title) => (
            <div
              key={title}
              className={styles.backlinkItem}
              onClick={() => onNavigate(title)}
            >
              <span className={styles.backlinkDot} />
              {title}
            </div>
          ))}
        </div>
      )}

      {/* History */}
      {note.history.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>History</div>
          {note.history.map((entry, i) => (
            <div key={i} className={styles.historyItem}>
              <span
                className={styles.historyDot}
                style={{
                  backgroundColor: entry.by.startsWith("agent")
                    ? "var(--accent-purple)"
                    : "var(--accent-amber)",
                }}
              />
              <span className={styles.historyText}>
                {entry.action}
                {entry.reason ? ` — ${entry.reason}` : ""}
              </span>
              <span className={styles.historyTime}>
                {formatTime(entry.at)}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
