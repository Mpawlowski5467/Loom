import { Folder } from "lucide-react";
import { useMemo } from "react";
import { useApp } from "@/context/app-ctx";
import { FOLDER_ORDER } from "@/components/layout/tree/treeModel";
import { cn } from "@/lib/utils";

const DOT = [
  "bg-community-1",
  "bg-community-2",
  "bg-community-3",
  "bg-community-4",
];

interface FolderCount {
  folder: string;
  count: number;
}

function topLevelFolders(folders: string[]): FolderCount[] {
  const counts = new Map<string, number>();
  for (const f of folders) {
    const top = f.split("/")[0] || "(root)";
    counts.set(top, (counts.get(top) ?? 0) + 1);
  }
  const rank = (f: string) => {
    const i = FOLDER_ORDER.findIndex((o) => o.folder === f);
    return i === -1 ? FOLDER_ORDER.length : i;
  };
  return [...counts]
    .map(([folder, count]) => ({ folder, count }))
    .sort(
      (a, b) =>
        rank(a.folder) - rank(b.folder) || a.folder.localeCompare(b.folder),
    );
}

const rowClass = (active: boolean) =>
  cn(
    "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-secondary-foreground",
    "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
    active && "bg-nav-active text-nav-active-foreground",
  );

/** Folders with note counts, then the communities legend. Both filter. */
export function GraphSidebar({ communitiesOn }: { communitiesOn: boolean }) {
  const { notes, communities, graphFilter, setGraphFilter } = useApp();
  const folders = useMemo(
    () =>
      topLevelFolders(
        notes.filter((n) => n.status !== "archived").map((n) => n.folder),
      ),
    [notes],
  );

  return (
    <nav
      aria-label="Graph filters"
      className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-3"
    >
      <section
        aria-labelledby="graph-folders"
        className="flex flex-col gap-0.5"
      >
        <h2
          id="graph-folders"
          className="px-2 pb-1 font-mono text-[11px] tracking-wider text-muted-foreground uppercase"
        >
          Folders
        </h2>
        <button
          type="button"
          aria-pressed={graphFilter.folder === null}
          onClick={() => setGraphFilter({ folder: null })}
          className={rowClass(graphFilter.folder === null)}
        >
          <Folder
            aria-hidden="true"
            className="size-3.5 text-muted-foreground"
          />
          All notes
          <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
            {folders.reduce((n, f) => n + f.count, 0)}
          </span>
        </button>
        {folders.map(({ folder, count }) => (
          <button
            key={folder}
            type="button"
            aria-pressed={graphFilter.folder === folder}
            onClick={() =>
              setGraphFilter({
                folder: graphFilter.folder === folder ? null : folder,
              })
            }
            className={rowClass(graphFilter.folder === folder)}
          >
            <Folder
              aria-hidden="true"
              className="size-3.5 text-muted-foreground"
            />
            <span className="truncate">{folder}</span>
            <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
              {count}
            </span>
          </button>
        ))}
      </section>
      <section
        aria-labelledby="graph-communities"
        className="flex flex-col gap-0.5"
      >
        <h2
          id="graph-communities"
          className="px-2 pb-1 font-mono text-[11px] tracking-wider text-muted-foreground uppercase"
        >
          Communities
        </h2>
        {communities.communities.length === 0 && (
          <p className="px-2 text-xs text-muted-foreground">
            Link notes to form communities.
          </p>
        )}
        {communities.communities.map((c) => {
          const value = c.slot ?? "other";
          const active = graphFilter.community === value;
          return (
            <button
              key={String(value)}
              type="button"
              aria-pressed={active}
              title={
                c.slot === null
                  ? "Smaller communities and unlinked notes"
                  : `Named after ${c.label}`
              }
              onClick={() =>
                setGraphFilter({ community: active ? null : value })
              }
              className={rowClass(active)}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  c.slot !== null && communitiesOn
                    ? DOT[c.slot]
                    : "bg-muted-foreground",
                )}
              />
              <span className="truncate">{c.label}</span>
              <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
                {c.size}
              </span>
            </button>
          );
        })}
      </section>
    </nav>
  );
}
