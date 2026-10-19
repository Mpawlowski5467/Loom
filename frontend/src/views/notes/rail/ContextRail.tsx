import { Separator } from "@/components/ui/separator";
import type { Note } from "@/data/types";
import { LocalGraph } from "./LocalGraph";
import { NoteActivity } from "./NoteActivity";
import { RelatedList } from "./RelatedList";

/** Right rail: local graph, related notes, agent activity. */
export function ContextRail({ note }: { note: Note }) {
  return (
    <div className="flex flex-col gap-5 p-4">
      <LocalGraph note={note} />
      <Separator />
      <RelatedList note={note} />
      <Separator />
      <NoteActivity note={note} />
    </div>
  );
}
