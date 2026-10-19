import { useCallback, useEffect, useRef, useState } from "react";
import {
  captureRelPath,
  previewCapture,
  type CapturePreview,
} from "@/api/captures";
import type { Capture } from "@/data/types";
import type { useCaptureJobs } from "./useCaptureJobs";

/** Per-capture state of the lazily fetched Weaver preview. */
export type PreviewState =
  | { status: "ready"; preview: CapturePreview }
  | { status: "error"; message: string };

/**
 * Fetch Weaver's proposal when a waiting capture is selected (it's an LLM
 * dry run, so it's lazy and cached for the session). Demo captures carry a
 * seed suggestion and skip the round trip.
 */
export function usePreviews(
  selected: Capture | undefined,
  jobs: ReturnType<typeof useCaptureJobs>,
  demoMode: boolean,
) {
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
  // In-flight ids dedupe the effect without a synchronous setState in it.
  const inFlight = useRef<Set<string>>(new Set());
  const { jobForCapture, loaded } = jobs;

  useEffect(() => {
    const cap = selected;
    if (!cap || (!loaded && !demoMode) || cap.status !== "pending") return;
    const job = jobForCapture(cap);
    if ((job && job.status !== "cancelled") || cap.suggestion) return;
    const id = cap.id;
    if (previews[id] || inFlight.current.has(id)) return;
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
  }, [selected, previews, jobForCapture, loaded, demoMode]);

  /** Drop a cached result so the effect fetches it again. */
  const retry = useCallback((id: string) => {
    setPreviews((p) => {
      const next = { ...p };
      delete next[id];
      return next;
    });
  }, []);

  return { previews, retry };
}
