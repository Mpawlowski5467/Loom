import { Kbd } from "@/components/shell/Kbd";

interface PaletteFooterProps {
  includeSuperseded: boolean;
  hiddenSuperseded: number;
  onToggleSuperseded: () => void;
}

/** Keyboard hints and the superseded toggle. */
export function PaletteFooter({
  includeSuperseded,
  hiddenSuperseded,
  onToggleSuperseded,
}: PaletteFooterProps) {
  const hint = "flex items-center gap-1";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-xs text-muted-foreground">
      <span className={hint}>
        <Kbd>↑↓</Kbd> navigate
      </span>
      <span className={hint}>
        <Kbd>↵</Kbd> open
      </span>
      <span className={hint}>
        <Kbd>⌥↵</Kbd> show in graph
      </span>
      <span className={hint}>
        <Kbd>⇧↵</Kbd> capture
      </span>
      <button
        type="button"
        aria-pressed={includeSuperseded}
        onClick={onToggleSuperseded}
        className="ml-auto flex items-center gap-1.5 rounded-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {includeSuperseded
          ? "Superseded shown"
          : `Superseded hidden${hiddenSuperseded ? ` (${hiddenSuperseded})` : ""}`}
        <Kbd>⌥S</Kbd>
      </button>
    </div>
  );
}
