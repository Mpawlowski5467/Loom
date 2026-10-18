import { Archive } from "lucide-react";
import { useEffect, useState } from "react";
import { getNoteFindings, type NoteFinding } from "@/api/findings";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context/app-ctx";
import { isSuperseded, supersededBy } from "@/data/supersession";
import type { Note } from "@/data/types";

interface ArchivistCardProps {
  note: Note;
  /** Show another note in the panel (the replacement). */
  onSelectNote: (id: string) => void;
}

/** Fetch Archivist's findings for a note; [] while loading or unsupported. */
function useFindings(note: Note): NoteFinding[] {
  const key = `${note.id}@${note.modified}`;
  const [state, setState] = useState<{ key: string; items: NoteFinding[] }>({
    key: "",
    items: [],
  });
  useEffect(() => {
    const controller = new AbortController();
    getNoteFindings(note, controller.signal).then(
      (items) =>
        !controller.signal.aborted && setState({ key, items: items ?? [] }),
      () => !controller.signal.aborted && setState({ key, items: [] }),
    );
    return () => controller.abort();
    // `key` covers the note fields the request depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state.items : [];
}

/**
 * Archivist's warnings about the note: superseded (read from frontmatter)
 * plus persisted audit findings (a backend gap, mocked). Nothing renders
 * when there's nothing to warn about.
 */
export function ArchivistCard({ note, onSelectNote }: ArchivistCardProps) {
  const { notes, resolveWikilink } = useApp();
  const findings = useFindings(note);
  const superseded = isSuperseded(note);
  const replacement = superseded
    ? supersededBy(note, notes, resolveWikilink)
    : null;
  if (!superseded && findings.length === 0) return null;
  return (
    <Alert variant="warning">
      <Archive aria-hidden="true" />
      <AlertTitle className="text-warning-foreground">Archivist</AlertTitle>
      <AlertDescription className="text-warning-foreground">
        <ul className="flex flex-col gap-1.5">
          {superseded && (
            <li>
              This note is superseded
              {replacement ? (
                <>
                  {" by "}
                  <Button
                    variant="link"
                    className="h-auto p-0 text-[length:inherit] text-warning-foreground underline"
                    onClick={() => onSelectNote(replacement.id)}
                  >
                    {replacement.title}
                  </Button>
                </>
              ) : null}
              . Prefer the newer note.
            </li>
          )}
          {findings.map((f) => (
            <li key={`${f.kind}:${f.message}`}>
              <span className="font-mono text-[11px] uppercase">{f.kind}</span>{" "}
              {f.message}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
