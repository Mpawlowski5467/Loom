import { MessagesSquare } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";

/**
 * Threads: Scribe's daily logs, Standups and Council chats. The route and
 * tab exist now; the view itself is built in the Threads phase.
 */
export function ThreadsView() {
  return (
    <EmptyState
      icon={<MessagesSquare />}
      title="Threads are on the way"
      description="Daily logs written by Scribe, Standups and past Council chats will be browsable here."
    />
  );
}
