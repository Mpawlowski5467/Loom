import { Link2, X } from "lucide-react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Button } from "@/components/ui/button";
import type { LinkSuggestion } from "./useNoteSuggestions";
import { WikilinkChip } from "./WikilinkChip";

interface SuggestionCardsProps {
  suggestions: LinkSuggestion[];
  /** Linking edits the note on the server, so it waits for a clean draft. */
  disabled: boolean;
  onLink: (s: LinkSuggestion) => void;
  onDismiss: (s: LinkSuggestion) => void;
}

/** Spider's link suggestions as dashed cards under the note body. */
export function SuggestionCards({
  suggestions,
  disabled,
  onLink,
  onDismiss,
}: SuggestionCardsProps) {
  if (suggestions.length === 0) return null;
  return (
    <section
      aria-label="Agent suggestions"
      className="mt-8 flex flex-col gap-2"
    >
      {suggestions.map((s) => (
        <div
          key={s.targetId}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border-strong px-3 py-2.5 text-sm"
        >
          <AgentAvatar actor="spider" />
          <p className="min-w-0 flex-1 text-secondary-foreground">
            Spider suggests linking <WikilinkChip target={s.targetTitle} />.
            {s.reason && <> {s.reason}</>}
          </p>
          <div className="flex gap-1">
            <Button
              size="xs"
              variant="outline"
              disabled={disabled}
              title={disabled ? "Save your edits first" : undefined}
              onClick={() => onLink(s)}
            >
              <Link2 aria-hidden="true" />
              Link
            </Button>
            <Button size="xs" variant="ghost" onClick={() => onDismiss(s)}>
              <X aria-hidden="true" />
              Dismiss
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}
