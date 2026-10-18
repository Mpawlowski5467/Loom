import { lazy, Suspense, type ReactNode } from "react";
import { backendNoteToFrontend, titleMapFromNotes } from "@/api/notes";
import { useApp } from "@/context/app-ctx";
import { ErrorBoundary } from "../ErrorBoundary";

const Palette = lazy(() =>
  import("../../views/Palette").then((m) => ({ default: m.Palette })),
);
const NewNoteModal = lazy(() =>
  import("../../views/NewNoteModal").then((m) => ({ default: m.NewNoteModal })),
);
const QuickCapture = lazy(() =>
  import("../QuickCapture").then((m) => ({ default: m.QuickCapture })),
);

/** The palette, new-note and quick-capture overlays. */
export function Overlays(): ReactNode {
  const {
    paletteOpen,
    newNoteOpen,
    setNewNoteOpen,
    newNoteTitle,
    setNewNoteTitle,
    quickCaptureOpen,
    setQuickCaptureOpen,
    notes,
    appendNote,
    openNote,
    pushToast,
    config,
  } = useApp();

  return (
    <>
      {paletteOpen && (
        <ErrorBoundary label="the command palette" resetKey={paletteOpen}>
          <Suspense fallback={null}>
            <Palette />
          </Suspense>
        </ErrorBoundary>
      )}
      {newNoteOpen && (
        <Suspense fallback={null}>
          <NewNoteModal
            initialTitle={newNoteTitle ?? ""}
            onClose={() => {
              setNewNoteOpen(false);
              setNewNoteTitle(null);
            }}
            onCreated={(record) => {
              const note = backendNoteToFrontend(
                record,
                titleMapFromNotes(notes),
              );
              appendNote(note);
              openNote(note.id);
              setNewNoteTitle(null);
              pushToast({
                icon: "✎",
                agent: "weaver",
                body: `Created [[${record.title}]] in ${
                  record.file_path.split("/threads/")[1] ?? record.file_path
                }`,
              });
            }}
          />
        </Suspense>
      )}
      {quickCaptureOpen && (
        <Suspense fallback={null}>
          <QuickCapture
            key={config?.active_vault ?? "default"}
            onClose={() => setQuickCaptureOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}
