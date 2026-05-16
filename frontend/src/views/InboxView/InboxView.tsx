import { useCallback, useEffect, useRef, useState } from "react";
import {
  archiveNote,
  type CaptureItem,
  fetchCaptures,
  processAllCaptures,
  processCapture,
  type ProcessResult,
} from "../../lib/api";
import { useApp } from "../../lib/context/useApp";
import { CaptureCard } from "./CaptureCard";
import styles from "./InboxView.module.css";
import { type CaptureState, FILTER_TABS, type FilterTab, POLL_MS } from "./types";

export interface InboxViewProps {
  onSelectCapture?: (noteId: string) => void;
}

export function InboxView({ onSelectCapture }: InboxViewProps) {
  const { addToast } = useApp();
  const [captures, setCaptures] = useState<CaptureItem[]>([]);
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [loading, setLoading] = useState(true);
  const [processingAll, setProcessingAll] = useState(false);
  const [captureStates, setCaptureStates] = useState<Record<string, CaptureState>>({});
  const mountedRef = useRef(true);

  const load = useCallback(() => {
    fetchCaptures()
      .then((data) => {
        if (mountedRef.current) setCaptures(data);
      })
      .catch((err) => console.error("Failed to load captures:", err))
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [load]);

  const getEffectiveStatus = (capture: CaptureItem): string => {
    if (capture.status === "archived") return "done";
    const key = capture.id || capture.file_path;
    const state = captureStates[key];
    if (state) return state.status;
    return "pending";
  };

  const getProcessResult = (capture: CaptureItem): ProcessResult | undefined => {
    const key = capture.id || capture.file_path;
    return captureStates[key]?.result;
  };

  const handleProcess = async (capture: CaptureItem) => {
    const key = capture.id || capture.file_path;
    setCaptureStates((prev) => ({ ...prev, [key]: { status: "processing" } }));

    try {
      const path = capture.file_path;
      const capturesIdx = path.indexOf("captures/");
      const relativePath = capturesIdx >= 0 ? path.substring(capturesIdx) : path;

      const result = await processCapture(relativePath);

      if (result.processed) {
        setCaptureStates((prev) => ({ ...prev, [key]: { status: "done", result } }));
        addToast(`Weaver created [[${result.note_title}]]`, "info");
      } else {
        setCaptureStates((prev) => ({ ...prev, [key]: { status: "pending" } }));
        addToast(`Processing failed: ${result.error}`, "danger");
      }
    } catch {
      setCaptureStates((prev) => ({ ...prev, [key]: { status: "pending" } }));
      addToast("Processing failed", "danger");
    }

    load();
  };

  const handleProcessAll = async () => {
    setProcessingAll(true);

    const pendingKeys = captures
      .filter((c) => getEffectiveStatus(c) === "pending")
      .map((c) => c.id || c.file_path);

    setCaptureStates((prev) => {
      const next = { ...prev };
      for (const key of pendingKeys) next[key] = { status: "processing" };
      return next;
    });

    try {
      const result = await processAllCaptures();
      addToast(
        `Processed ${result.processed}/${result.total} captures`,
        result.processed > 0 ? "success" : "info",
      );

      setCaptureStates((prev) => {
        const next = { ...prev };
        for (const r of result.results) {
          if (r.note_id) {
            for (const key of pendingKeys) {
              if (!next[key] || next[key].status === "processing") {
                next[key] = { status: "done", result: r };
                break;
              }
            }
          }
        }
        for (const key of pendingKeys) {
          if (next[key]?.status === "processing") {
            next[key] = { status: "pending" };
          }
        }
        return next;
      });
    } catch {
      addToast("Batch processing failed", "danger");
      setCaptureStates((prev) => {
        const next = { ...prev };
        for (const key of pendingKeys) {
          if (next[key]?.status === "processing") next[key] = { status: "pending" };
        }
        return next;
      });
    } finally {
      setProcessingAll(false);
      load();
    }
  };

  const handleArchive = async (capture: CaptureItem) => {
    if (!capture.id) return;
    try {
      await archiveNote(capture.id);
      addToast("Capture archived", "success");
      load();
    } catch {
      addToast("Archive failed", "danger");
    }
  };

  const filtered = captures.filter((c) => {
    const eff = getEffectiveStatus(c);
    if (activeFilter === "all") return true;
    if (activeFilter === "pending") return eff === "pending";
    if (activeFilter === "processing") return eff === "processing";
    if (activeFilter === "done") return eff === "done" || c.status === "archived";
    const src = (c.source || "manual").toLowerCase();
    if (activeFilter === "manual") return src === "manual" || src === "";
    return true;
  });

  const pendingCount = captures.filter((c) => getEffectiveStatus(c) === "pending").length;
  const processingCount = captures.filter(
    (c) => getEffectiveStatus(c) === "processing",
  ).length;
  const doneCount = captures.filter(
    (c) => getEffectiveStatus(c) === "done" || c.status === "archived",
  ).length;

  return (
    <div className={styles.inbox}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Captures Inbox</h1>
          <p className={styles.subtitle}>
            {captures.length} captures &middot; {pendingCount} pending
            {processingCount > 0 && <> &middot; {processingCount} processing</>} &middot;{" "}
            {doneCount} done
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.sortBtn}>Sort: Newest</button>
          <button
            className={styles.processAllBtn}
            onClick={handleProcessAll}
            disabled={processingAll || pendingCount === 0}
          >
            {processingAll ? "Processing..." : "Process All"}
          </button>
        </div>
      </div>

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
            effectiveStatus={getEffectiveStatus(capture)}
            processResult={getProcessResult(capture)}
            onProcess={() => handleProcess(capture)}
            onArchive={() => handleArchive(capture)}
            onClick={() => capture.id && onSelectCapture?.(capture.id)}
          />
        ))}
      </div>
    </div>
  );
}
