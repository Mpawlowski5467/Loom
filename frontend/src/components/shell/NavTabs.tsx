import { NavLink } from "react-router";
import { Badge } from "@/components/ui/badge";
import { useApp } from "@/context/app-ctx";
import type { Tab } from "@/data/types";
import { cn } from "@/lib/utils";

const TABS: { tab: Exclude<Tab, "settings">; label: string; to: string }[] = [
  { tab: "graph", label: "Graph", to: "/graph" },
  { tab: "notes", label: "Notes", to: "/notes" },
  { tab: "board", label: "Board", to: "/board" },
  { tab: "inbox", label: "Inbox", to: "/inbox" },
  { tab: "threads", label: "Threads", to: "/threads" },
];

/** Captures still waiting on the user or an agent. */
function useInboxCount(): number {
  const { captures } = useApp();
  return captures.filter((c) => c.status !== "done").length;
}

/** The five view tabs. Notes reopens the last note rather than /notes. */
export function NavTabs() {
  const { setTab } = useApp();
  const inboxCount = useInboxCount();
  return (
    <nav aria-label="Views" className="flex items-center gap-0.5">
      {TABS.map(({ tab, label, to }) => (
        <NavLink
          key={tab}
          to={to}
          onClick={(e) => {
            if (tab !== "notes" || e.metaKey || e.ctrlKey) return;
            e.preventDefault();
            setTab("notes");
          }}
          className={({ isActive }) =>
            cn(
              "flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors sm:px-3",
              "hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              isActive && "bg-nav-active text-nav-active-foreground",
            )
          }
        >
          {label}
          {tab === "inbox" && inboxCount > 0 && (
            <>
              <span className="sr-only">({inboxCount} waiting)</span>
              <Badge
                aria-hidden="true"
                variant="secondary"
                className="h-4.5 min-w-4.5 rounded-full px-1 font-mono text-[10px] tabular-nums"
              >
                {inboxCount}
              </Badge>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
