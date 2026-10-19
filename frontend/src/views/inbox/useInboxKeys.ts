import { useEffect } from "react";
import type { Capture } from "@/data/types";

interface InboxKeys {
  visible: readonly Capture[];
  selectedId: string | null;
  /** Approve/edit are possible (a proposal is ready, nothing in flight). */
  actionable: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
  onEdit: () => void;
  onApprove: () => void;
}

/** j/k move between captures, e edits the proposal, ↵ approves it. */
export function useInboxKeys(k: InboxKeys) {
  const {
    visible,
    selectedId,
    actionable,
    disabled,
    onSelect,
    onEdit,
    onApprove,
  } = k;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (
        el?.tagName === "INPUT" ||
        el?.tagName === "TEXTAREA" ||
        el?.tagName === "SELECT" ||
        el?.isContentEditable
      )
        return;
      // Enter on a focused button activates it; don't also approve.
      if (e.key === "Enter" && el?.closest("button, a, [role=menuitem]"))
        return;
      const idx = visible.findIndex((c) => c.id === selectedId);
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const next =
          visible[
            e.key === "j"
              ? Math.min(visible.length - 1, idx + 1)
              : Math.max(0, idx - 1)
          ];
        if (next) onSelect(next.id);
      } else if (e.key === "e" && actionable) {
        e.preventDefault();
        onEdit();
      } else if (e.key === "Enter" && actionable) {
        e.preventDefault();
        onApprove();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selectedId, actionable, disabled, onSelect, onEdit, onApprove]);
}
