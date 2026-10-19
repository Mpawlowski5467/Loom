import { GitCompareArrows } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useApp } from "@/context/app-ctx";
import { formatDate } from "@/data/formatDate";
import { supersessionOf } from "@/data/supersession";
import type { Note } from "@/data/types";
import { WikilinkChip } from "./WikilinkChip";

/** "Supersedes [[old]]. Archivist marked the old plan superseded on …" */
export function SupersessionBanner({ note }: { note: Note }) {
  const { resolveWikilink, noteById } = useApp();
  const info = supersessionOf(note, resolveWikilink, noteById);
  if (!info) return null;
  return (
    <Alert variant="info" className="mb-6">
      <GitCompareArrows aria-hidden="true" />
      <AlertDescription className="text-banner-foreground">
        <p>
          Supersedes <WikilinkChip target={info.target} />.
          {info.supersededAt && (
            <>
              {" "}
              Archivist marked the old{" "}
              {note.type === "project" ? "plan" : "note"} superseded on{" "}
              {formatDate(info.supersededAt)}.
            </>
          )}
        </p>
      </AlertDescription>
    </Alert>
  );
}
