import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useApp } from "../context/app-ctx";
import { Button } from "../components/primitives/Button";
import { EditSuggestionModal } from "./EditSuggestionModal";
import { CaptureCard } from "./inbox/CaptureCard";
import { DetailPane, type PreviewState } from "./inbox/DetailPane";
import { JobHistory } from "./inbox/JobHistory";
import { useCaptureJobs } from "./inbox/useCaptureJobs";
import {
  captureRelPath,
  commitCapture,
  getCaptureProcessingPolicy,
  previewCapture,
  skipCapture,
  updateCaptureProcessingPolicy,
  type CaptureJob,
  type CapturePreview,
  type CaptureProcessingMode,
  type CaptureProcessingPolicy,
  type CommitResult,
  type ProcessResult,
} from "../api/captures";
import { backendNoteToFrontend, titleMapFromNotes } from "../api/notes";
import { ApiError } from "../api/client";
import { readDemoMode } from "../data/demoMode";
import type { Capture, CaptureOutcome } from "../data/types";

const DEFAULT_PROCESSING_POLICY: CaptureProcessingPolicy = {
  mode: "manual",
  trusted_sources: [],
  concurrency: 1,
  max_retries: 2,
  base_backoff_seconds: 5,
  stale_running_seconds: 1800,
};

function isDemoCapture(capture: Capture): boolean {
  return !capture.filePath && Boolean(capture.suggestion);
}

function outcomeOf(result: ProcessResult | CommitResult): CaptureOutcome {
  if (result.outcome) return result.outcome;
  if (result.review_required) return "needs_review";
  if (result.capture_archived) return "filed";
  if ("processed" in result) {
    // Compatibility with older backends, which only returned ``processed``.
    return result.processed ? "filed" : "failed";
  }
  // A committed note whose source capture was not archived is intentionally
  // still actionable in the Inbox; fail closed to review instead of hiding it.
  return "needs_review";
}

function retryableStatus(
  capture: Capture,
): "pending" | "needs_review" | "failed" {
  if (capture.status === "needs_review" || capture.reviewRequired) {
    return "needs_review";
  }
  return capture.status === "failed" ? "failed" : "pending";
}

export function InboxView(): ReactNode {
  const {
    notes,
    captures,
    capturesLoaded,
    capturesError,
    selectedCaptureId,
    selectCapture,
    setCaptureStatus,
    removeCapture,
    noteById,
    pushToast,
    appendNote,
    openNote,
  } = useApp();
  const [demoMode] = useState(readDemoMode);
  const {
    jobs,
    loaded: jobsLoaded,
    error: jobsError,
    jobForCapture,
    enqueue: enqueueJob,
    enqueueBatch: enqueueJobs,
    retry: retryJob,
    cancel: cancelJob,
    pruneHistory,
  } = useCaptureJobs({ enabled: !demoMode });
  const [surface, setSurface] = useState<"captures" | "jobs">("captures");
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
  const [draftNoteIds, setDraftNoteIds] = useState<Record<string, string>>({});
  const [busyJobCaptures, setBusyJobCaptures] = useState<Set<string>>(
    new Set(),
  );
  const [policy, setPolicy] = useState<CaptureProcessingPolicy>(
    DEFAULT_PROCESSING_POLICY,
  );
  const [policyLoaded, setPolicyLoaded] = useState(false);
  const [policySaving, setPolicySaving] = useState(false);
  const [trustedSourcesDraft, setTrustedSourcesDraft] = useState("");
  // Ids with a preview fetch in flight — dedupes the lazy effect without a
  // synchronous setState in the effect body (which would cascade renders).
  const inFlight = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (demoMode) {
      setPolicyLoaded(true);
      return;
    }
    const ctrl = new AbortController();
    getCaptureProcessingPolicy(ctrl.signal)
      .then((next) => {
        setPolicy(next);
        setTrustedSourcesDraft(next.trusted_sources.join(", "));
        setPolicyLoaded(true);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setPolicyLoaded(true);
      });
    return () => ctrl.abort();
  }, [demoMode]);

  const captureSelectable = useCallback(
    (capture: Capture): boolean => {
      if (capture.status === "done") return false;
      const status = jobForCapture(capture)?.status;
      return (
        status !== "queued" &&
        status !== "running" &&
        status !== "retrying" &&
        status !== "completed"
      );
    },
    [jobForCapture],
  );

  const captureQueueable = useCallback(
    (capture: Capture): boolean =>
      !demoMode && !isDemoCapture(capture) && captureSelectable(capture),
    [captureSelectable, demoMode],
  );

  const removeInboxCapture = useCallback(
    (id: string) => {
      removeCapture(id);
      setSelectedIds((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    },
    [removeCapture],
  );

  const filteredCaptures = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return captures;
    return captures.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.body.toLowerCase().includes(q) ||
        c.folder.toLowerCase().includes(q) ||
        (c.source ?? "").toLowerCase().includes(q) ||
        (c.lastError ?? "").toLowerCase().includes(q) ||
        Object.values(c.provenance ?? {}).some((value) =>
          value.toLowerCase().includes(q),
        ),
    );
  }, [captures, search]);

  // No fallback to captures[0]: a cleared/absent selection renders the
  // detail-less state rather than force-selecting (and previewing) a capture
  // the user never picked.
  const selected = captures.find((c) => c.id === selectedCaptureId);
  const selectedJob = selected ? jobForCapture(selected) : undefined;
  const selectedDraftNoteId = selected
    ? (draftNoteIds[selected.id] ??
      selected.draftNoteId ??
      notes.find((note) => note.source === `capture:${selected.id}`)?.id)
    : undefined;
  const pendingCount = captures.filter((c) => c.status !== "done").length;

  const filteredIds = useMemo(
    () =>
      filteredCaptures.filter(captureSelectable).map((capture) => capture.id),
    [captureSelectable, filteredCaptures],
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

  const selectionCount = captures.filter(
    (capture) => selectedIds.has(capture.id) && captureSelectable(capture),
  ).length;
  const queueableSelectionCount = captures.filter(
    (capture) => selectedIds.has(capture.id) && captureQueueable(capture),
  ).length;

  const skipSelected = async () => {
    if (selectionCount === 0) return;
    const targets = captures.filter(
      (capture) => selectedIds.has(capture.id) && captureSelectable(capture),
    );
    targets.forEach((capture) => setCaptureStatus(capture.id, "processing"));
    setSelectedIds(new Set());

    let skipped = 0;
    let failed = 0;
    for (const capture of targets) {
      try {
        // Demo captures do not exist on disk; keep their interaction local.
        if (!capture.filePath && capture.suggestion) {
          removeInboxCapture(capture.id);
          skipped++;
          continue;
        }
        const result = await skipCapture(
          captureRelPath(capture),
          "Skipped by user from Inbox",
        );
        if (result.outcome === "skipped" || result.capture_archived) {
          removeInboxCapture(capture.id);
          skipped++;
        } else {
          setCaptureStatus(capture.id, retryableStatus(capture));
          failed++;
        }
      } catch (err) {
        setCaptureStatus(capture.id, retryableStatus(capture));
        failed++;
        pushToast({
          icon: "⚠",
          agent: "archivist",
          body: `Couldn’t skip "${capture.title}": ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
    pushToast({
      icon: failed === 0 ? "↷" : "⚠",
      agent: "archivist",
      body:
        failed === 0
          ? `Skipped ${skipped} capture${skipped === 1 ? "" : "s"}`
          : `Skipped ${skipped}; ${failed} failed`,
    });
  };

  const skipOne = useCallback(
    async (capture: Capture) => {
      setCaptureStatus(capture.id, "processing");
      try {
        if (!capture.filePath && capture.suggestion) {
          removeInboxCapture(capture.id);
        } else {
          const result = await skipCapture(
            captureRelPath(capture),
            "Skipped by user from Inbox",
          );
          if (result.outcome !== "skipped" && !result.capture_archived) {
            throw new Error(result.error || "Capture was not archived");
          }
          removeInboxCapture(capture.id);
        }
        pushToast({
          icon: "↷",
          agent: "archivist",
          body: `Skipped "${capture.title}"`,
        });
      } catch (err) {
        setCaptureStatus(capture.id, retryableStatus(capture));
        pushToast({
          icon: "⚠",
          agent: "archivist",
          body: `Couldn’t skip "${capture.title}": ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },
    [pushToast, removeInboxCapture, setCaptureStatus],
  );

  const queueCapture = useCallback(
    async (capture: Capture, force = false): Promise<boolean> => {
      if (demoMode || isDemoCapture(capture)) return false;
      if (busyJobCaptures.has(capture.id)) return false;
      setBusyJobCaptures((current) => new Set(current).add(capture.id));
      try {
        const existing = jobForCapture(capture);
        if (
          existing &&
          (existing.status === "failed" ||
            existing.status === "needs_review" ||
            existing.status === "cancelled")
        ) {
          await retryJob(existing.id);
        } else {
          await enqueueJob(capture, force);
        }
        pushToast({
          icon: "↻",
          agent: "weaver",
          body:
            existing?.status === "failed" ||
            existing?.status === "needs_review" ||
            existing?.status === "cancelled"
              ? `Queued another attempt for "${capture.title}"`
              : `Queued "${capture.title}" for processing`,
        });
        return true;
      } catch (err) {
        pushToast({
          icon: "⚠",
          agent: "weaver",
          body: `Couldn’t queue "${capture.title}": ${err instanceof Error ? err.message : String(err)}`,
        });
        return false;
      } finally {
        setBusyJobCaptures((current) => {
          const next = new Set(current);
          next.delete(capture.id);
          return next;
        });
      }
    },
    [busyJobCaptures, demoMode, enqueueJob, jobForCapture, pushToast, retryJob],
  );

  const cancelQueuedJob = useCallback(
    async (capture: Capture, job: CaptureJob) => {
      if (busyJobCaptures.has(capture.id)) return;
      setBusyJobCaptures((current) => new Set(current).add(capture.id));
      try {
        await cancelJob(job.id);
        pushToast({
          icon: "×",
          agent: "weaver",
          body: `Cancelled processing for "${capture.title}"`,
        });
      } catch (err) {
        pushToast({
          icon: "⚠",
          agent: "weaver",
          body: `Couldn’t cancel "${capture.title}": ${err instanceof Error ? err.message : String(err)}`,
        });
      } finally {
        setBusyJobCaptures((current) => {
          const next = new Set(current);
          next.delete(capture.id);
          return next;
        });
      }
    },
    [busyJobCaptures, cancelJob, pushToast],
  );

  const cancelLedgerJob = useCallback(
    async (job: CaptureJob) => {
      const title =
        captures.find((capture) => capture.id === job.capture_id)?.title ??
        job.capture_id;
      try {
        await cancelJob(job.id);
        pushToast({
          icon: "×",
          agent: "weaver",
          body: `Cancelled processing for "${title}"`,
        });
      } catch (err) {
        pushToast({
          icon: "⚠",
          agent: "weaver",
          body: `Couldn’t cancel "${title}": ${err instanceof Error ? err.message : String(err)}`,
        });
        throw err;
      }
    },
    [cancelJob, captures, pushToast],
  );

  const retryLedgerJob = useCallback(
    async (job: CaptureJob) => {
      const title =
        captures.find((capture) => capture.id === job.capture_id)?.title ??
        job.capture_id;
      try {
        await retryJob(job.id);
        pushToast({
          icon: "↻",
          agent: "weaver",
          body: `Queued another attempt for "${title}"`,
        });
      } catch (err) {
        pushToast({
          icon: "⚠",
          agent: "weaver",
          body: `Couldn’t retry "${title}": ${err instanceof Error ? err.message : String(err)}`,
        });
        throw err;
      }
    },
    [captures, pushToast, retryJob],
  );

  const pruneLedgerHistory = useCallback(
    async (olderThanDays?: number) => {
      const deleted = await pruneHistory(olderThanDays);
      pushToast({
        icon: "⌫",
        agent: "archivist",
        body:
          deleted === 1
            ? "Removed 1 processing-history row"
            : `Removed ${deleted} processing-history rows`,
      });
      return deleted;
    },
    [pruneHistory, pushToast],
  );

  const processSelected = async () => {
    if (selectionCount === 0) return;
    const targets = captures.filter(
      (capture) => selectedIds.has(capture.id) && captureQueueable(capture),
    );
    if (targets.length === 0) return;
    pushToast({
      icon: "↻",
      agent: "weaver",
      body: `Queueing ${targets.length} capture${targets.length === 1 ? "" : "s"}`,
    });
    setSelectedIds(new Set());

    setBusyJobCaptures((current) => {
      const next = new Set(current);
      targets.forEach((capture) => next.add(capture.id));
      return next;
    });

    const retryTargets = targets.filter((capture) => {
      const status = jobForCapture(capture)?.status;
      return status === "failed" || status === "needs_review";
    });
    const forceTargets = targets.filter(
      (capture) => jobForCapture(capture)?.status === "cancelled",
    );
    const freshTargets = targets.filter(
      (capture) =>
        !retryTargets.includes(capture) && !forceTargets.includes(capture),
    );

    const operations: Promise<CaptureJob[]>[] = [];
    if (freshTargets.length > 0) {
      operations.push(enqueueJobs(freshTargets));
    }
    if (forceTargets.length > 0) {
      operations.push(enqueueJobs(forceTargets, true));
    }
    operations.push(
      ...retryTargets.map((capture) => {
        const job = jobForCapture(capture) as CaptureJob;
        return retryJob(job.id).then((retried) => [retried]);
      }),
    );

    const results = await Promise.allSettled(operations);
    let queued = 0;
    for (const result of results) {
      if (result.status === "fulfilled") {
        queued += result.value.length;
      }
    }
    setBusyJobCaptures((current) => {
      const next = new Set(current);
      targets.forEach((capture) => next.delete(capture.id));
      return next;
    });
    const failed = targets.length - queued;
    if (targets.length > 1 || failed > 0) {
      pushToast({
        icon: queued > 0 ? "✓" : "⚠",
        agent: "weaver",
        body:
          failed === 0
            ? `Queued ${queued} captures`
            : `Queued ${queued}; ${failed} failed`,
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

  // Apply a committed note to app state + surface the agent-chain toasts.
  const onCommitted = useCallback(
    (cap: Capture, result: CommitResult) => {
      const note = backendNoteToFrontend(result.note, titleMapFromNotes(notes));
      appendNote(note);
      const outcome = outcomeOf(result);
      if (outcome === "filed") {
        removeInboxCapture(cap.id);
        pushToast({
          icon: "🧶",
          agent: "weaver",
          body: `Filed "${result.note.title}" → ${result.note.type || "note"}`,
        });
      } else {
        setDraftNoteIds((current) => ({
          ...current,
          [cap.id]: result.note.id,
        }));
        setCaptureStatus(cap.id, "needs_review");
        pushToast({
          icon: "⚠",
          agent: "sentinel",
          body: `"${result.note.title}" was created but needs review${result.validation_reasons[0] ? `: ${result.validation_reasons[0]}` : ""}`,
        });
      }
      const linkCount = result.linked.length;
      const suggCount = result.suggested.length;
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
      if (outcome === "filed") openNote(note.id);
    },
    [
      notes,
      appendNote,
      removeInboxCapture,
      setCaptureStatus,
      pushToast,
      openNote,
    ],
  );

  const handleCommitError = useCallback(
    (cap: Capture, err: unknown) => {
      if (err instanceof ApiError && err.status === 404) {
        // Already processed (e.g. via bulk Process) — treat as filed.
        removeInboxCapture(cap.id);
        pushToast({
          icon: "✓",
          agent: "weaver",
          body: "Capture already processed.",
        });
        return;
      }
      setCaptureStatus(cap.id, "pending");
      pushToast({
        icon: "⚠",
        agent: "weaver",
        body: `Failed to file: ${err instanceof Error ? err.message : String(err)}`,
      });
    },
    [removeInboxCapture, setCaptureStatus, pushToast],
  );

  const commitPreview = useCallback(
    async (cap: Capture, preview: CapturePreview) => {
      setCaptureStatus(cap.id, "processing");
      try {
        const result = await commitCapture({
          capture_path: captureRelPath(cap),
          note_type: preview.note_type,
          folder: preview.folder,
          title: preview.title,
          tags: preview.tags,
          body: preview.body,
        });
        onCommitted(cap, result);
      } catch (err) {
        handleCommitError(cap, err);
      }
    },
    [setCaptureStatus, onCommitted, handleCommitError],
  );

  // Accept the current suggestion. Demo captures carry a seed suggestion and
  // file locally; real captures commit the fetched preview through the backend.
  const accept = useCallback(() => {
    if (!selected) return;
    if (
      selectedJob?.status === "needs_review" ||
      selectedJob?.status === "failed" ||
      selected.status === "needs_review" ||
      selected.status === "failed"
    ) {
      void queueCapture(selected, true);
      return;
    }
    if (selected.suggestion) {
      fileCapture(selected.id);
      return;
    }
    const st = previews[selected.id];
    if (st?.status === "ready") void commitPreview(selected, st.preview);
  }, [
    selected,
    selectedJob,
    previews,
    fileCapture,
    commitPreview,
    queueCapture,
  ]);

  const retryPreview = useCallback((id: string) => {
    // Clearing the entry re-triggers the lazy effect (previews is a dep).
    setPreviews((p) => {
      const next = { ...p };
      delete next[id];
      return next;
    });
  }, []);

  // Lazily fetch Weaver's proposal when a pending capture is selected. Demo
  // captures already carry a seed ``suggestion`` so they skip the round-trip.
  useEffect(() => {
    const cap = selected;
    if (!cap) return;
    if (!jobsLoaded && !demoMode) return;
    if (cap.status !== "pending") return;
    const job = jobForCapture(cap);
    if (job && job.status !== "cancelled") return;
    if (cap.suggestion) return; // demo seed suggestion — no round-trip
    const id = cap.id;
    if (previews[id]) return; // already resolved (ready / error)
    if (inFlight.current.has(id)) return; // fetch already running

    inFlight.current.add(id);
    let active = true;
    const ctrl = new AbortController();
    previewCapture({ capture_path: captureRelPath(cap) }, ctrl.signal)
      .then((preview) => {
        inFlight.current.delete(id);
        if (!active) return;
        setPreviews((p) => ({
          ...p,
          [id]: preview
            ? { status: "ready", preview }
            : { status: "error", message: "Empty capture — nothing to file." },
        }));
      })
      .catch((err: unknown) => {
        inFlight.current.delete(id);
        if (
          !active ||
          (err instanceof DOMException && err.name === "AbortError")
        )
          return;
        setPreviews((p) => ({
          ...p,
          [id]: {
            status: "error",
            message: err instanceof Error ? err.message : "Preview failed",
          },
        }));
      });

    return () => {
      active = false;
      ctrl.abort();
    };
  }, [selected, previews, jobForCapture, jobsLoaded, demoMode]);

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
      const previewReady =
        !!selected && previews[selected.id]?.status === "ready";
      const jobStatus = selected ? jobForCapture(selected)?.status : undefined;
      const actionable =
        !!selected &&
        selected.status !== "done" &&
        selected.status !== "processing" &&
        jobStatus !== "queued" &&
        jobStatus !== "running" &&
        jobStatus !== "retrying" &&
        jobStatus !== "completed" &&
        (!!selected.suggestion || previewReady);
      if (e.key === "j") {
        e.preventDefault();
        const n =
          filteredCaptures[Math.min(filteredCaptures.length - 1, idx + 1)];
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
        accept();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    filteredCaptures,
    selected,
    editing,
    selectCapture,
    accept,
    previews,
    jobForCapture,
  ]);

  const savePolicy = useCallback(
    async (update: {
      mode?: CaptureProcessingMode;
      trusted_sources?: string[];
    }) => {
      if (policySaving) return;
      const previous = policy;
      const optimistic = { ...policy, ...update };
      setPolicy(optimistic);
      setPolicySaving(true);
      try {
        const saved = await updateCaptureProcessingPolicy(update);
        setPolicy(saved);
        setTrustedSourcesDraft(saved.trusted_sources.join(", "));
        pushToast({
          icon: "✓",
          agent: "weaver",
          body:
            saved.mode === "manual"
              ? "Automatic queueing is off; queued jobs will keep running"
              : saved.mode === "all"
                ? "Current and new Inbox captures will be queued automatically"
                : "Selected source captures will be queued automatically",
        });
      } catch (err) {
        setPolicy(previous);
        pushToast({
          icon: "⚠",
          agent: "weaver",
          body: `Couldn’t save Inbox automation: ${err instanceof Error ? err.message : String(err)}`,
        });
      } finally {
        setPolicySaving(false);
      }
    },
    [policy, policySaving, pushToast],
  );

  const saveTrustedSources = useCallback(() => {
    const trustedSources = Array.from(
      new Set(
        trustedSourcesDraft
          .split(",")
          .map((source) => source.trim())
          .filter(Boolean),
      ),
    );
    void savePolicy({ trusted_sources: trustedSources });
  }, [savePolicy, trustedSourcesDraft]);

  const inboxSurfaces = ["captures", "jobs"] as const;
  const onSurfaceTabKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % inboxSurfaces.length;
    }
    if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + inboxSurfaces.length) % inboxSurfaces.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = inboxSurfaces.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = inboxSurfaces[nextIndex]!;
    setSurface(next);
    const tabList = event.currentTarget.parentElement;
    requestAnimationFrame(() => {
      tabList
        ?.querySelector<HTMLButtonElement>(`[data-inbox-surface="${next}"]`)
        ?.focus();
    });
  };

  return (
    <div className="inbox-view">
      <div
        className={`inbox-list${surface === "jobs" ? " inbox-list--jobs" : ""}`}
      >
        <div className="inbox-toolbar">
          <div
            className="inbox-surface-tabs"
            role="tablist"
            aria-label="Inbox views"
          >
            <button
              id="inbox-captures-tab"
              type="button"
              role="tab"
              data-inbox-surface="captures"
              className="inbox-title inbox-surface-tab"
              aria-selected={surface === "captures"}
              aria-controls="inbox-captures-panel"
              tabIndex={surface === "captures" ? 0 : -1}
              onClick={() => setSurface("captures")}
              onKeyDown={(event) => onSurfaceTabKeyDown(event, 0)}
            >
              Captures
              <span className="inbox-count">{pendingCount}</span>
            </button>
            <button
              id="inbox-jobs-tab"
              type="button"
              role="tab"
              data-inbox-surface="jobs"
              className="inbox-title inbox-surface-tab"
              aria-selected={surface === "jobs"}
              aria-controls="inbox-jobs-panel"
              tabIndex={surface === "jobs" ? 0 : -1}
              onClick={() => setSurface("jobs")}
              onKeyDown={(event) => onSurfaceTabKeyDown(event, 1)}
            >
              Jobs
              <span className="inbox-count">{jobs.length}</span>
            </button>
          </div>
        </div>
        {surface === "captures" ? (
          <div
            id="inbox-captures-panel"
            className="inbox-capture-panel"
            role="tabpanel"
            aria-labelledby="inbox-captures-tab"
          >
            <section className="inbox-automation" aria-label="Inbox automation">
              <div className="inbox-automation-row">
                <label htmlFor="inbox-processing-policy">Auto-process</label>
                <select
                  id="inbox-processing-policy"
                  value={policy.mode}
                  disabled={demoMode || !policyLoaded || policySaving}
                  onChange={(event) =>
                    void savePolicy({
                      mode: event.target.value as CaptureProcessingMode,
                    })
                  }
                >
                  <option value="manual">Manual</option>
                  <option value="trusted">Selected sources</option>
                  <option value="all">All captures</option>
                </select>
                <span className="inbox-automation-state" role="status">
                  {demoMode
                    ? "demo only"
                    : !policyLoaded
                      ? "loading…"
                      : policySaving
                        ? "saving…"
                        : policy.mode === "manual"
                          ? "review first"
                          : "jobs enabled"}
                </span>
              </div>
              {policy.mode === "trusted" && (
                <div className="inbox-trusted-sources">
                  <label htmlFor="inbox-trusted-source-list">
                    Auto-process source names
                  </label>
                  <div>
                    <input
                      id="inbox-trusted-source-list"
                      value={trustedSourcesDraft}
                      onChange={(event) =>
                        setTrustedSourcesDraft(event.target.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          saveTrustedSources();
                        }
                      }}
                      placeholder="bridge:gmail, agent:researcher"
                      disabled={policySaving}
                    />
                    <Button
                      size="sm"
                      onClick={saveTrustedSources}
                      disabled={policySaving}
                    >
                      Save
                    </Button>
                  </div>
                  <span>
                    Comma-separated exact names. This is an automation
                    allowlist, not authentication.
                  </span>
                </div>
              )}
              {jobsError && (
                <div className="inbox-jobs-error" role="alert">
                  Job updates unavailable: {jobsError}
                </div>
              )}
            </section>
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
                  onClick={() => void skipSelected()}
                  disabled={selectionCount === 0}
                >
                  Skip
                </Button>
                <Button
                  variant="amber"
                  size="sm"
                  onClick={processSelected}
                  disabled={queueableSelectionCount === 0}
                >
                  Queue
                </Button>
              </div>
            </div>
            <div className="inbox-scroll">
              {filteredCaptures.length === 0 &&
                (!capturesLoaded && captures.length === 0 ? (
                  <div className="inbox-empty" role="status">
                    Loading captures…
                  </div>
                ) : capturesError && captures.length === 0 ? (
                  <div className="inbox-empty inbox-empty-error" role="alert">
                    <span className="inbox-empty-title">
                      Couldn’t load captures
                    </span>
                    <span className="inbox-empty-hint">
                      {capturesError}. Check the backend and reload.
                    </span>
                  </div>
                ) : captures.length === 0 ? (
                  <div className="inbox-empty inbox-empty-zero">
                    <span className="inbox-empty-title">Inbox is clear</span>
                    <span className="inbox-empty-hint">
                      Captures land here for triage. Drop a note in{" "}
                      <code>captures/</code> or run a Shuttle agent to fill it.
                    </span>
                  </div>
                ) : (
                  <div className="inbox-empty">
                    No captures match “{search.trim()}”
                  </div>
                ))}
              {filteredCaptures.map((c) => (
                <CaptureCard
                  key={c.id}
                  capture={c}
                  job={jobForCapture(c)}
                  isActive={selected?.id === c.id}
                  isChecked={selectedIds.has(c.id) && captureSelectable(c)}
                  selectionDisabled={!captureSelectable(c)}
                  noteById={noteById}
                  onSelect={selectCapture}
                  onToggle={toggleOne}
                />
              ))}
            </div>
          </div>
        ) : (
          <div
            id="inbox-jobs-panel"
            className="inbox-job-surface"
            role="tabpanel"
            aria-labelledby="inbox-jobs-tab"
          >
            <JobHistory
              jobs={jobs}
              captures={captures}
              loaded={jobsLoaded}
              error={jobsError}
              onOpenNote={openNote}
              onCancel={cancelLedgerJob}
              onRetry={retryLedgerJob}
              onPruneHistory={pruneLedgerHistory}
            />
          </div>
        )}
      </div>

      {surface === "captures" && selected && (
        <DetailPane
          capture={selected}
          job={selectedJob}
          jobBusy={busyJobCaptures.has(selected.id)}
          canQueue={!demoMode && !isDemoCapture(selected)}
          preview={previews[selected.id]}
          noteById={noteById}
          onAccept={accept}
          onEdit={() => setEditing(true)}
          onSkip={() => void skipOne(selected)}
          onRetry={retryPreview}
          onEnqueue={() => void queueCapture(selected)}
          onRetryJob={() => void queueCapture(selected, true)}
          onCancelJob={() => {
            if (selectedJob) void cancelQueuedJob(selected, selectedJob);
          }}
          onOpenDraft={
            selectedDraftNoteId
              ? () => openNote(selectedDraftNoteId)
              : undefined
          }
        />
      )}

      {surface === "captures" && editing && selected && (
        <EditSuggestionModal
          capture={selected}
          preview={
            previews[selected.id]?.status === "ready"
              ? (
                  previews[selected.id] as {
                    status: "ready";
                    preview: CapturePreview;
                  }
                ).preview
              : undefined
          }
          onClose={() => setEditing(false)}
          onAccepted={(result) => {
            onCommitted(selected, result);
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}
