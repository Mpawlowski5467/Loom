import { cn } from "@/lib/utils";
import type { ThemeId } from "@/theme/registry";

const COMMUNITY_DOTS = [
  "bg-community-1",
  "bg-community-2",
  "bg-community-3",
  "bg-community-4",
];

/**
 * A miniature Loom window painted in `theme`'s own variables: setting
 * `data-theme` on the wrapper re-scopes every token inside it, so the
 * preview stays true no matter which theme the app is in.
 */
export function ThemePreview({
  theme,
  className,
}: {
  theme: ThemeId;
  className?: string;
}) {
  return (
    <div
      data-theme={theme}
      aria-hidden="true"
      className={cn(
        "flex h-24 overflow-hidden rounded-md border border-border bg-background text-foreground",
        className,
      )}
    >
      <div className="flex w-1/4 flex-col gap-1.5 border-r border-border bg-sidebar p-2">
        <span className="h-1.5 w-3/4 rounded-full bg-nav-active-foreground/70" />
        <span className="h-1.5 w-1/2 rounded-full bg-muted-foreground/50" />
        <span className="h-1.5 w-2/3 rounded-full bg-muted-foreground/50" />
      </div>
      <div className="flex flex-1 flex-col">
        <div className="flex h-4 items-center gap-1 border-b border-border px-2">
          <span className="size-1.5 rounded-full bg-border-strong" />
          <span className="size-1.5 rounded-full bg-border-strong" />
        </div>
        <div className="flex flex-1 flex-col gap-1.5 p-2">
          <span className="h-2 w-2/3 rounded-full bg-foreground" />
          <span className="h-1.5 w-full rounded-full bg-secondary-foreground/40" />
          <div className="flex items-center gap-1">
            <span className="rounded-sm bg-chip px-1 text-[8px] leading-3 text-chip-foreground">
              [[link]]
            </span>
            <span className="h-1.5 flex-1 rounded-full bg-secondary-foreground/40" />
          </div>
          <div className="mt-auto flex items-center justify-between">
            <span className="flex gap-1">
              {COMMUNITY_DOTS.map((dot) => (
                <span key={dot} className={cn("size-1.5 rounded-full", dot)} />
              ))}
            </span>
            <span className="h-3 w-8 rounded-sm bg-brand" />
          </div>
        </div>
      </div>
    </div>
  );
}
