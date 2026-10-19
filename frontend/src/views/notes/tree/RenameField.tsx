import { Input } from "@/components/ui/input";
import type { TreeRowContext } from "./treeContext";

/** Inline rename for the row being renamed; Enter saves, Esc/blur cancel. */
export function RenameField({
  actions,
  label,
  style,
}: {
  actions: TreeRowContext["actions"];
  label: string;
  style: React.CSSProperties;
}) {
  const it = actions.interaction;
  if (it?.kind !== "rename") return null;
  return (
    <div style={style} className="flex flex-col gap-1 py-0.5 pr-2">
      <Input
        autoFocus
        aria-label={label}
        aria-invalid={it.error !== null}
        value={it.draft}
        className="h-7 text-sm"
        onChange={(e) =>
          actions.setInteraction({ ...it, draft: e.target.value })
        }
        onBlur={() => actions.setInteraction(null)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void actions.submitRename();
          } else if (e.key === "Escape") {
            e.preventDefault();
            actions.setInteraction(null);
          }
        }}
      />
      {it.error && (
        <p role="alert" className="text-xs text-danger-foreground">
          {it.error}
        </p>
      )}
    </div>
  );
}
