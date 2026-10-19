import { useCallback, useMemo, useState } from "react";
import type { Capture } from "@/data/types";

/**
 * Checkbox selection over the visible captures. Only selectable captures
 * (not filed, not mid-job) count, so a capture that becomes busy drops out.
 */
export function useBulkSelection(
  captures: readonly Capture[],
  visible: readonly Capture[],
  selectable: (c: Capture) => boolean,
  queueable: (c: Capture) => boolean,
) {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const visibleIds = useMemo(
    () => visible.filter(selectable).map((c) => c.id),
    [visible, selectable],
  );
  const allSelected =
    visibleIds.length > 0 && visibleIds.every((id) => ids.has(id));
  const someSelected = !allSelected && visibleIds.some((id) => ids.has(id));
  const selected = captures.filter((c) => ids.has(c.id) && selectable(c));
  const queueableCount = captures.filter(
    (c) => ids.has(c.id) && queueable(c),
  ).length;

  const toggle = (id: string) =>
    setIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setIds((prev) => {
      const next = new Set(prev);
      for (const id of visibleIds) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  const drop = useCallback(
    (id: string) =>
      setIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      }),
    [],
  );
  const clear = () => setIds(new Set());

  return {
    ids,
    visibleIds,
    allSelected,
    someSelected,
    selected,
    queueableCount,
    toggle,
    toggleAll,
    drop,
    clear,
  };
}
