import { Plus, Settings } from "lucide-react";
import { Link, useMatch } from "react-router";
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
 * theme toggle, settings and "New note". Below 768px the view tabs take a
 * second row of their own and "New note" shrinks to its icon.
 */
export function AppHeader() {
  const { setNewNoteOpen } = useApp();
  // A static className: Tooltip's Slot can't merge NavLink's className
  // function, which left the link unstyled.
  const inSettings = useMatch("/settings/*") !== null;
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-background px-4 py-2 md:gap-x-4">
      <Link
        to="/graph"
        className="flex items-center gap-2 rounded-md text-sm font-semibold tracking-tight text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <LoomLogo />
        Loom
      </Link>
      <div className="order-last -mx-1 w-full overflow-x-auto px-1 [scrollbar-width:none] md:order-none md:mx-0 md:w-auto md:px-0 [&::-webkit-scrollbar]:hidden">
        <NavTabs />
      </div>
      <div className="flex min-w-0 flex-1 justify-center md:min-w-48">
        <SearchTrigger />
      </div>
      <div className="flex items-center gap-1">
        <AgentStatus />
        <span className="mx-2 hidden h-4 w-px bg-border md:block" />
        <ThemeToggle />
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/settings"
              aria-label="Settings"
              aria-current={inSettings ? "page" : undefined}
              className={cn(
                "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                inSettings && "bg-nav-active text-nav-active-foreground",
              )}
            >
              <Settings aria-hidden="true" className="size-4" />
            </Link>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
        <Button
          size="sm"
          className="ml-1 max-sm:size-8 max-sm:px-0 sm:ml-2"
          onClick={() => setNewNoteOpen(true)}
        >
          <Plus aria-hidden="true" />
          <span className="max-sm:sr-only">New note</span>
        </Button>
      </div>
    </header>
  );
}
