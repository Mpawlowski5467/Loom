import { useCallback, useEffect, useState } from "react";
import {
  getCaptureProcessingPolicy,
  updateCaptureProcessingPolicy,
  type CaptureProcessingMode,
  type CaptureProcessingPolicy,
} from "@/api/captures";
import { useApp } from "@/context/app-ctx";
import { DEFAULT_PROCESSING_POLICY, errorText } from "./captureHelpers";

/** The Inbox auto-processing policy: load once, save optimistically. */
export function usePolicy(demoMode: boolean) {
  const { pushToast } = useApp();
  const [policy, setPolicy] = useState<CaptureProcessingPolicy>(
    DEFAULT_PROCESSING_POLICY,
  );
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [trustedDraft, setTrustedDraft] = useState("");

  useEffect(() => {
    if (demoMode) {
      setLoaded(true);
      return;
    }
    const ctrl = new AbortController();
    getCaptureProcessingPolicy(ctrl.signal)
      .then((next) => {
        setPolicy(next);
        setTrustedDraft(next.trusted_sources.join(", "));
        setLoaded(true);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoaded(true);
      });
    return () => ctrl.abort();
  }, [demoMode]);

  const save = useCallback(
    async (update: {
      mode?: CaptureProcessingMode;
      trusted_sources?: string[];
    }) => {
      if (saving) return;
      const previous = policy;
      setPolicy({ ...policy, ...update });
      setSaving(true);
      try {
        const saved = await updateCaptureProcessingPolicy(update);
        setPolicy(saved);
        setTrustedDraft(saved.trusted_sources.join(", "));
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
          body: `Couldn’t save Inbox automation: ${errorText(err)}`,
        });
      } finally {
        setSaving(false);
      }
    },
    [policy, saving, pushToast],
  );

  const saveTrusted = useCallback(() => {
    const list = Array.from(
      new Set(
        trustedDraft
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    );
    void save({ trusted_sources: list });
  }, [save, trustedDraft]);

  return {
    policy,
    loaded,
    saving,
    trustedDraft,
    setTrustedDraft,
    save,
    saveTrusted,
  };
}
