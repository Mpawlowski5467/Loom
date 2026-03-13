import { useEffect, useRef, useState } from "react";
import { fetchCaptures, type CaptureItem } from "../../lib/api";
import styles from "./InboxView.module.css";

type FilterTab = "all" | "pending" | "processing" | "done" | "email" | "github" | "manual";

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "processing", label: "Processing" },
  { id: "done", label: "Done" },
  { id: "email", label: "Email" },
  { id: "github", label: "GitHub" },
  { id: "manual", label: "Manual" },
];

const SOURCE_ICONS: Record<string, string> = {
  email: "📧",
  github: "🐙",
  manual: "📝",
};

export interface InboxViewProps {
  onSelectCapture?: (noteId: string) => void;
}

export function InboxView({ onSelectCapture }: InboxViewProps) {
  const [captures, setCaptures] = useState<CaptureItem[]>([]);
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    const load = () => {
      fetchCaptures()
        .then((data) => {
          if (!cancelled) setCaptures(data);
        })
        .catch((err) => console.error("Failed to load captures:", err))
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    load();
    const interval = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, []);

  const filtered = captures.filter((c) => {
    if (activeFilter === "all") return true;
    if (activeFilter === "pending") return c.status === "active";
    if (activeFilter === "processing") return c.status === "processing";
    if (activeFilter === "done") return c.status === "archived";
    // Source-based filters
    const src = (c.source || "manual").toLowerCase();
    if (activeFilter === "email") return src.includes("email");
    if (activeFilter === "github") return src.includes("github");
    if (activeFilter === "manual") return src === "manual" || src === "";
    return true;
  });

  const pendingCount = captures.filter((c) => c.status === "active").length;
  const doneCount = captures.filter((c) => c.status === "archived").length;

  return (
    <div className={styles.inbox}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Captures Inbox</h1>
          <p className={styles.subtitle}>
            {captures.length} captures &middot; {pendingCount} pending &middot;{" "}
            {doneCount} done
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.sortBtn}>Sort: Newest</button>
          <button className={styles.processAllBtn}>🕸 Process All</button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className={styles.filterRow}>
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`${styles.filterTab} ${activeFilter === tab.id ? styles.filterTabActive : ""}`}
            onClick={() => setActiveFilter(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Captures list */}
      <div className={styles.captureList}>
        {loading && captures.length === 0 && (
          <div className={styles.empty}>Loading captures...</div>
        )}

        {!loading && filtered.length === 0 && (
          <div className={styles.empty}>
            {captures.length === 0
              ? "No captures waiting. Drop files into captures/ or connect integrations to start."
              : "No captures match this filter."}
          </div>
        )}

        {filtered.map((capture) => (
          <CaptureCard
            key={capture.id || capture.file_path}
            capture={capture}
            onClick={() => capture.id && onSelectCapture?.(capture.id)}
          />
        ))}
      </div>
    </div>
  );
}

/* -- Capture Card sub-component ------------------------------------------- */

function getStatusClass(status: string): string {
  if (status === "processing") return styles.statusProcessing;
  if (status === "archived") return styles.statusDone;
  return styles.statusPending;
}

function getStatusLabel(status: string): string {
  if (status === "processing") return "Processing";
  if (status === "archived") return "Done";
  return "Pending";
}

function getSourceIcon(source: string): string {
  const src = (source || "").toLowerCase();
  if (src.includes("email")) return SOURCE_ICONS.email;
  if (src.includes("github")) return SOURCE_ICONS.github;
  return SOURCE_ICONS.manual;
}

function formatTime(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function CaptureCard({
  capture,
  onClick,
}: {
  capture: CaptureItem;
  onClick: () => void;
}) {
  const borderClass =
    capture.status === "processing"
      ? styles.borderProcessing
      : capture.status === "archived"
        ? styles.borderDone
        : styles.borderPending;

  return (
    <div className={`${styles.card} ${borderClass}`} onClick={onClick}>
      <div className={styles.cardTop}>
        <span className={styles.cardSourceIcon}>
          {getSourceIcon(capture.source)}
        </span>
        <div className={styles.cardIdent}>
          <span className={styles.cardTitle}>
            {capture.title || "Untitled capture"}
          </span>
          {capture.preview && (
            <span className={styles.cardPreview}>{capture.preview}</span>
          )}
        </div>
        <div className={styles.cardMeta}>
          <span className={styles.cardTime}>
            {formatTime(capture.modified || capture.created)}
          </span>
          <span className={`${styles.statusBadge} ${getStatusClass(capture.status)}`}>
            {getStatusLabel(capture.status)}
          </span>
        </div>
      </div>
      <div className={styles.cardActions}>
        <button
          className={styles.actionProcess}
          onClick={(e) => e.stopPropagation()}
        >
          Process
        </button>
        <button
          className={styles.actionPreview}
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          Preview
        </button>
        <button
          className={styles.actionArchive}
          onClick={(e) => e.stopPropagation()}
        >
          Archive
        </button>
      </div>
    </div>
  );
}
