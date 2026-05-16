import type { CaptureItem, ProcessResult } from "../../lib/api";
import styles from "./InboxView.module.css";
import { SOURCE_LABELS } from "./types";

interface CaptureCardProps {
  capture: CaptureItem;
  effectiveStatus: string;
  processResult?: ProcessResult;
  onProcess: () => void;
  onArchive: () => void;
  onClick: () => void;
}

function getStatusClass(status: string): string {
  if (status === "processing") return styles.statusProcessing;
  if (status === "done") return styles.statusDone;
  return styles.statusPending;
}

function getStatusLabel(status: string, result?: ProcessResult): string {
  if (status === "processing") return "Processing";
  if (status === "done" && result?.note_title) {
    return `Filed → [[${result.note_title}]]`;
  }
  if (status === "done") return "Done";
  return "Pending";
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

export function CaptureCard({
  capture,
  effectiveStatus,
  processResult,
  onProcess,
  onArchive,
  onClick,
}: CaptureCardProps) {
  const borderClass =
    effectiveStatus === "processing"
      ? styles.borderProcessing
      : effectiveStatus === "done"
        ? styles.borderDone
        : styles.borderPending;

  return (
    <div className={`${styles.card} ${borderClass}`} onClick={onClick}>
      <div className={styles.cardTop}>
        <span className={styles.cardSourceLabel}>{SOURCE_LABELS.manual}</span>
        <div className={styles.cardIdent}>
          <span className={styles.cardTitle}>{capture.title || "Untitled capture"}</span>
          {capture.preview && <span className={styles.cardPreview}>{capture.preview}</span>}
        </div>
        <div className={styles.cardMeta}>
          <span className={styles.cardTime}>
            {formatTime(capture.modified || capture.created)}
          </span>
          <span className={`${styles.statusBadge} ${getStatusClass(effectiveStatus)}`}>
            {getStatusLabel(effectiveStatus, processResult)}
          </span>
        </div>
      </div>

      {effectiveStatus === "done" && processResult?.note_type && (
        <div className={styles.filedInfo}>
          <span className={styles.filedLabel}>Type: {processResult.note_type}</span>
        </div>
      )}

      <div className={styles.cardActions}>
        <button
          className={styles.actionProcess}
          onClick={(e) => {
            e.stopPropagation();
            onProcess();
          }}
          disabled={effectiveStatus === "processing" || effectiveStatus === "done"}
        >
          {effectiveStatus === "processing" ? "Processing..." : "Process"}
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
          onClick={(e) => {
            e.stopPropagation();
            onArchive();
          }}
        >
          Archive
        </button>
      </div>
    </div>
  );
}
