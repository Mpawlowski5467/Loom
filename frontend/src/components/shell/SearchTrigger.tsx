import { Search } from "lucide-react";
import { useApp } from "@/context/app-ctx";
import { Kbd } from "./Kbd";
import { modKeyLabel } from "./platform";

/** Looks like a search field; opens the command palette. */
export function SearchTrigger() {
  const { setPaletteOpen } = useApp();
  return (
    <button
      type="button"
      onClick={() => setPaletteOpen(true)}
      aria-keyshortcuts="Meta+K Control+K"
      className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-muted px-2.5 text-sm text-muted-foreground transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:max-w-sm"
    >
      <Search aria-hidden="true" className="size-4 shrink-0" />
      <span className="truncate">Search notes or capture a thought…</span>
      <Kbd className="ml-auto hidden sm:inline-flex">{modKeyLabel()} K</Kbd>
    </button>
  );
}
