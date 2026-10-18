import { useEffect, useRef } from "react";
import type { Tab } from "@/data/types";

/** Second key of a `g` chord → the view it opens. */
export const G_CHORDS: Record<string, Exclude<Tab, "settings">> = {
  g: "graph",
  n: "notes",
  b: "board",
  i: "inbox",
  t: "threads",
};

/** How long after `g` the second key still counts. */
const CHORD_WINDOW_MS = 1000;

export interface ShortcutHandlers {
  togglePalette: () => void;
  closePalette: () => boolean;
  newNote: () => void;
  quickCapture: () => void;
  toggleTree: (() => void) | null;
  openSettings: () => void;
  goTo: (tab: Exclude<Tab, "settings">) => void;
}

/** Typing targets where single-letter shortcuts must not fire. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  // Modal dialogs own the keyboard while they're open.
  return target.closest('[role="dialog"], [role="alertdialog"]') !== null;
}

/**
 * App-wide keys: ⌘/Ctrl+K palette, ⌘N new note, ⌘⇧C capture, ⌘B tree,
 * ⌘; settings, Esc closes the palette, and `g` chords (g g / g n / g b /
 * g i / g t) to switch views. Chords are ignored while typing. Listens in the
 * capture phase so a completed chord's second key (`i`, `b`…) never reaches
 * a view's own shortcut handler.
 */
export function useGlobalShortcuts(handlers: ShortcutHandlers): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    let chordAt = 0;
    const onKey = (e: KeyboardEvent) => {
      const h = ref.current;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && !e.altKey) {
        const action =
          key === "k"
            ? h.togglePalette
            : key === "n" && !e.shiftKey
              ? h.newNote
              : key === "c" && e.shiftKey
                ? h.quickCapture
                : key === "b"
                  ? h.toggleTree
                  : e.key === ";"
                    ? h.openSettings
                    : null;
        if (action) {
          e.preventDefault();
          action();
        }
        return;
      }
      if (e.key === "Escape") {
        if (h.closePalette()) e.preventDefault();
        return;
      }
      if (e.altKey || e.shiftKey || isEditableTarget(e.target)) {
        chordAt = 0;
        return;
      }
      const now = Date.now();
      if (chordAt && now - chordAt <= CHORD_WINDOW_MS && G_CHORDS[key]) {
        chordAt = 0;
        e.preventDefault();
        e.stopImmediatePropagation();
        h.goTo(G_CHORDS[key]);
        return;
      }
      chordAt = key === "g" ? now : 0;
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, []);
}
