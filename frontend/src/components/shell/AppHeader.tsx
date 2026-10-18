import { Plus, Settings } from "lucide-react";
import { Link, NavLink } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useApp } from "@/context/app-ctx";
import { cn } from "@/lib/utils";
import { AgentStatus } from "./AgentStatus";
import { LoomLogo } from "./LoomLogo";
import { NavTabs } from "./NavTabs";
import { SearchTrigger } from "./SearchTrigger";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The app header: logo and wordmark, view tabs, search, agent status,
 * theme toggle, settings and "New note". Wraps onto a second row on
 * narrow windows rather than scrolling.
 */
export function AppHeader() {
  const { setNewNoteOpen } = useApp();
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-background px-4 py-2">
      <Link
        to="/graph"
        className="flex items-center gap-2 rounded-md text-sm font-semibold tracking-tight text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <LoomLogo />
        Loom
      </Link>
      <NavTabs />
      <div className="flex min-w-48 flex-1 justify-center">
        <SearchTrigger />
      </div>
      <div className="flex items-center gap-1">
        <AgentStatus />
        <span className="mx-2 hidden h-4 w-px bg-border md:block" />
        <ThemeToggle />
        <Tooltip>
          <TooltipTrigger asChild>
            <NavLink
              to="/settings"
              aria-label="Settings"
              className={({ isActive }) =>
                cn(
                  "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  isActive && "bg-nav-active text-nav-active-foreground",
                )
              }
            >
              <Settings aria-hidden="true" className="size-4" />
            </NavLink>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
        <Button size="sm" className="ml-2" onClick={() => setNewNoteOpen(true)}>
          <Plus aria-hidden="true" />
          New note
        </Button>
      </div>
    </header>
  );
}
