import { useEffect } from "react";
import { useApp } from "../context/app-ctx";
import { extractHeadings } from "./renderMarkdown";

/** Resolve human heading fragments after the selected note body has loaded. */
export function NoteAnchorScroll() {
  const { tab, currentNoteId, noteHeading, noteById } = useApp();
  const note = currentNoteId ? noteById(currentNoteId) : undefined;
  useEffect(() => {
    if (tab !== "thread" || !noteHeading || !note || note.bodyLoaded === false)
      return;
    const normalize = (text: string) =>
      text
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-+|-+$/g, "");
    const target = extractHeadings(note.body).find(
      (heading) =>
        heading.id === noteHeading ||
        normalize(heading.text) === normalize(noteHeading),
    );
    if (!target) return;
    const timer = window.setTimeout(
      () =>
        document.getElementById(target.id)?.scrollIntoView({ block: "start" }),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [note, noteHeading, tab]);
  return null;
}
