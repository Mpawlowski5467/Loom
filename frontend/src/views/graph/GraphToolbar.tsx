import {
  Download,
  Focus,
  History,
  PanelLeft,
  Palette,
  SlidersHorizontal,
} from "lucide-react";
import { Fragment } from "react";
import { DisplayControls } from "@/components/graph/DisplayControls";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Toggle } from "@/components/ui/toggle";

export type ExportFormat = "png" | "svg" | "json";

interface GraphToolbarProps {
  crumbs: string[];
  communitiesOn: boolean;
  onCommunitiesChange: (on: boolean) => void;
  showSuperseded: boolean;
  onShowSupersededChange: (on: boolean) => void;
  localOnly: boolean;
  onLocalOnlyChange: (on: boolean) => void;
  /** Local only needs a selected note. */
  localOnlyDisabled: boolean;
  onToggleSidebar: () => void;
  onExport: (format: ExportFormat) => void;
}

/** Breadcrumb, view toggles, display settings and export. */
export function GraphToolbar(p: GraphToolbarProps) {
  const toggleClass =
    "h-8 gap-1.5 px-2.5 text-xs data-[state=on]:bg-nav-active data-[state=on]:text-nav-active-foreground";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Toggle graph sidebar"
        title="Toggle sidebar (⌘B)"
        onClick={p.onToggleSidebar}
      >
        <PanelLeft aria-hidden="true" />
      </Button>
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          {p.crumbs.map((c, i) => (
            <Fragment key={`${i}-${c}`}>
              {i > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem className="min-w-0">
                {i === p.crumbs.length - 1 ? (
                  <BreadcrumbPage className="truncate">{c}</BreadcrumbPage>
                ) : (
                  <span className="truncate font-mono text-xs">{c}</span>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ml-auto flex flex-wrap items-center gap-1">
        <Toggle
          size="sm"
          variant="outline"
          className={toggleClass}
          pressed={p.communitiesOn}
          onPressedChange={p.onCommunitiesChange}
        >
          <Palette aria-hidden="true" />
          Communities
        </Toggle>
        <Toggle
          size="sm"
          variant="outline"
          className={toggleClass}
          pressed={p.showSuperseded}
          onPressedChange={p.onShowSupersededChange}
        >
          <History aria-hidden="true" />
          Superseded
        </Toggle>
        <Toggle
          size="sm"
          variant="outline"
          className={toggleClass}
          pressed={p.localOnly}
          disabled={p.localOnlyDisabled}
          title={
            p.localOnlyDisabled
              ? "Select a note first"
              : "Show the selected note and its direct links (I)"
          }
          onPressedChange={p.onLocalOnlyChange}
        >
          <Focus aria-hidden="true" />
          Local only
        </Toggle>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 text-xs">
              <SlidersHorizontal aria-hidden="true" />
              Display
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="max-h-[70vh] w-auto overflow-y-auto"
          >
            <DisplayControls />
          </PopoverContent>
        </Popover>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Export graph">
              <Download aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => p.onExport("png")}>
              Export PNG
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => p.onExport("svg")}>
              Export SVG
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => p.onExport("json")}>
              Export JSON
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
