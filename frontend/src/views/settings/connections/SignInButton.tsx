import { useId } from "react";
import { Button } from "@/components/ui/button";
import { ACTION_ROW, NOTE } from "./styles";

interface SignInButtonProps {
  label: string;
  enabled: boolean;
  busy: boolean;
  /** Why sign-in is unavailable, shown while it is disabled. */
  hint?: string;
  onClick: () => void;
}

/** The connector's sign-in action, explaining itself while disabled. */
export function SignInButton({
  label,
  enabled,
  busy,
  hint,
  onClick,
}: SignInButtonProps) {
  const hintId = useId();
  const showHint = !enabled && !busy && hint;
  return (
    <div className={ACTION_ROW}>
      <Button
        type="button"
        size="sm"
        onClick={onClick}
        disabled={!enabled || busy}
        title={showHint ? hint : undefined}
        aria-describedby={showHint ? hintId : undefined}
      >
        {busy ? "Opening…" : label}
      </Button>
      {showHint && (
        <p className={NOTE} id={hintId} role="note">
          {hint}
        </p>
      )}
    </div>
  );
}
