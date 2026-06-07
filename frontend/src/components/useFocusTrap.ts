import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

interface FocusTrapOptions {
  /** Called when Escape is pressed (handled at window level so it fires even
   * after focus has fallen to <body>). Omit to leave Escape to the caller. */
  onEscape?: () => void;
  /** Skip focusing the first element on mount (e.g. the dialog already sets
   * autoFocus on a specific control). Defaults to false. */
  skipInitialFocus?: boolean;
}

/**
 * Focus management for modal dialogs:
 *  - traps Tab / Shift+Tab within the returned ref's subtree,
 *  - restores focus to the previously-focused element on unmount,
 *  - optionally closes on Escape via a window-level listener (works even after
 *    focus leaves the dialog, unlike an element-scoped onKeyDown).
 *
 * Attach the returned ref to the dialog's container element. This is the shared
 * implementation of the pattern TraceModal had inline; one hook closes the
 * trap/restore/Escape gaps across every dialog at once.
 */
export function useFocusTrap<T extends HTMLElement>({
  onEscape,
  skipInitialFocus = false,
}: FocusTrapOptions = {}) {
  const ref = useRef<T | null>(null);
  // Keep the latest onEscape in a ref so the mount-time listener always calls
  // the current closure (e.g. EditSuggestionModal's dirty-aware requestClose),
  // not a stale one captured on open.
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        // Exclude elements hidden via the `hidden` attribute or aria-hidden.
        // (The :not([disabled]) cases are already handled in the selector.)
        (el) => !el.hidden && el.getAttribute("aria-hidden") !== "true",
      );

    // Move focus into the dialog unless it already owns focus (e.g. an
    // autoFocus'd input) or the caller opted out.
    if (!skipInitialFocus && !node.contains(document.activeElement)) {
      focusables()[0]?.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onEscapeRef.current) {
        e.preventDefault();
        onEscapeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const els = focusables();
      if (els.length === 0) {
        e.preventDefault();
        return;
      }
      const first = els[0];
      const last = els[els.length - 1];
      const active = document.activeElement;
      // Wrap around the ends, and pull a stray focus (on <body>) back in.
      if (e.shiftKey) {
        if (active === first || !node.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !node.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      // Restore focus to where it was before the dialog opened, so the next Tab
      // resumes from the trigger rather than the top of the document.
      previouslyFocused?.focus?.();
    };
    // onEscape is intentionally captured once on open; callers pass a stable fn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ref;
}
