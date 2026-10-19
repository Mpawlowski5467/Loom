import { useEffect, useRef, useState } from "react";
import { listModels } from "@/api/providers";
import type { ModelsResponse } from "@/api/types";
import type { ProviderForm, ProviderName } from "../providerModels";

/** Live model listings, fetched once per provider when its card opens. */
export function useLiveModels(
  openName: ProviderName,
  providers: Record<string, ProviderForm>,
) {
  const [liveModels, setLiveModels] = useState<
    Partial<Record<ProviderName, ModelsResponse>>
  >({});
  const modelsFetchedRef = useRef(new Set<ProviderName>());

  useEffect(() => {
    if (!providers[openName] || openName === "codex") return;
    if (modelsFetchedRef.current.has(openName)) return;
    modelsFetchedRef.current.add(openName);
    let cancelled = false;
    void listModels(openName)
      .then((models) => {
        if (!cancelled) {
          setLiveModels((prev) => ({ ...prev, [openName]: models }));
        }
      })
      .catch(() => {
        // Static catalog and the saved model remain available offline.
        modelsFetchedRef.current.delete(openName);
      });
    return () => {
      cancelled = true;
    };
  }, [openName, providers]);

  return liveModels;
}
