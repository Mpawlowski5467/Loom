import { useCallback, useMemo, useState } from "react";
import { useApp } from "@/context/app-ctx";
import { readDemoMode } from "@/data/demoMode";
import type { Capture } from "@/data/types";
import { useIsDesktop } from "@/lib/useIsDesktop";
import {
  captureMatchesFilter,
  isDemoCapture,
  jobBusy,
  type InboxFilter,
} from "./captureHelpers";
import { rowStatus } from "./captureStatus";
import { useBulkSelection } from "./useBulkSelection";
import { useCaptureActions } from "./useCaptureActions";
import { useCaptureJobs } from "./useCaptureJobs";
import { useInboxKeys } from "./useInboxKeys";
import { useJobActions } from "./useJobActions";
import { usePolicy } from "./usePolicy";
import { usePreviews } from "./usePreviews";
import { useProposals } from "./useProposals";

function matchesSearch(c: Capture, q: string): boolean {
  return [
    c.title,
    c.body,
    c.folder,
    c.source ?? "",
    c.lastError ?? "",
    ...Object.values(c.provenance ?? {}),
  ].some((v) => v.toLowerCase().includes(q));
}

/**
 * Everything the Inbox shows and does: jobs, policy, filters and search,
 * bulk selection, the selected capture's preview, and the actions on it.
 */
export function useInbox() {
  const app = useApp();
  const {
    captures,
    notes,
    selectedCaptureId,
    selectCapture,
    removeCapture,
    openNote,
    pushToast,
  } = app;
  const [demoMode] = useState(readDemoMode);
  const jobs = useCaptureJobs({ enabled: !demoMode });
  const policy = usePolicy(demoMode);
  const proposals = useProposals(captures, !demoMode);
  const desktop = useIsDesktop();
  const [surface, setSurface] = useState("captures");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const { jobForCapture } = jobs;

  const selectable = useCallback(
    (c: Capture) => c.status !== "done" && !jobBusy(jobForCapture(c)),
    [jobForCapture],
  );
  const queueable = useCallback(
    (c: Capture) => !demoMode && !isDemoCapture(c) && selectable(c),
    [demoMode, selectable],
  );
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? captures.filter((c) => matchesSearch(c, q)) : captures;
  }, [captures, search]);
  const count = (f: InboxFilter) =>
    searched.filter((c) => captureMatchesFilter(c, jobForCapture(c), f)).length;
  const visible = useMemo(
    () =>
      searched.filter((c) => captureMatchesFilter(c, jobForCapture(c), filter)),
    [searched, jobForCapture, filter],
  );
  const selection = useBulkSelection(captures, visible, selectable, queueable);
  const { drop } = selection;
  const remove = useCallback(
    (id: string) => {
      removeCapture(id);
      drop(id);
    },
    [removeCapture, drop],
  );
  const actions = useCaptureActions(remove);
  const jobActions = useJobActions(jobs, demoMode);

  // No fallback to the first capture: nothing is previewed until picked.
  const selected = captures.find((c) => c.id === selectedCaptureId);
  const selectedJob = selected ? jobForCapture(selected) : undefined;
  const { previews, retry } = usePreviews(selected, jobs, demoMode);
  const preview = selected ? previews[selected.id] : undefined;
  const ready = preview?.status === "ready" ? preview.preview : undefined;
  // A review-required capture's draft is unpublished; link it only once it's
  // a published note we actually have.
  const draftId = selected
    ? notes.find(
        (n) =>
          n.id === selected.draftNoteId ||
          n.source === `capture:${selected.id}`,
      )?.id
    : undefined;

  const approve = () => {
    if (selected)
      actions.approve(
        selected,
        selectedJob,
        ready,
        (c, force) => void jobActions.queue(c, force),
      );
  };
  const actionable =
    !!selected &&
    selected.status === "pending" &&
    !jobBusy(selectedJob) &&
    (Boolean(selected.suggestion) || Boolean(ready));
  useInboxKeys({
    visible,
    selectedId: selected?.id ?? null,
    actionable,
    disabled: editing || surface !== "captures",
    onSelect: selectCapture,
    onEdit: () => setEditing(true),
    onApprove: approve,
  });

  const statusOf = (c: Capture) =>
    rowStatus(
      c,
      jobForCapture(c),
      previews[c.id]?.status === "ready" ||
        proposals?.get(c.id)?.ready === true,
    );
  return {
    captures,
    notes,
    selectedCaptureId,
    selectCapture,
    removeCapture,
    openNote,
    pushToast,
    demoMode,
    jobs,
    policy,
    proposals,
    desktop,
    surface,
    setSurface,
    filter,
    setFilter,
    search,
    setSearch,
    editing,
    setEditing,
    jobForCapture,
    selectable,
    queueable,
    searched,
    count,
    visible,
    selection,
    drop,
    remove,
    actions,
    jobActions,
    selected,
    selectedJob,
    previews,
    retry,
    preview,
    ready,
    draftId,
    approve,
    actionable,
    statusOf,
  };
}
