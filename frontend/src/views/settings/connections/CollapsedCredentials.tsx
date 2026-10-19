import { Button } from "@/components/ui/button";
import { INLINE_LINK } from "./styles";

/** Saved OAuth credentials, reduced to one line with an Edit link. */
export function CollapsedCredentials({
  clientId,
  onEdit,
}: {
  clientId: string;
  onEdit: () => void;
}) {
  const tail = clientId.length > 4 ? `…${clientId.slice(-4)}` : clientId;
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span>Client ID {tail} saved</span>
      <Button
        type="button"
        variant="link"
        className={INLINE_LINK}
        onClick={onEdit}
      >
        Edit
      </Button>
    </p>
  );
}
