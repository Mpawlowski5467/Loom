import { Maximize, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface GraphZoomControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  disabled: boolean;
}

/** Zoom in/out/fit, bottom-right of the canvas. */
export function GraphZoomControls({
  onZoomIn,
  onZoomOut,
  onFit,
  disabled,
}: GraphZoomControlsProps) {
  const btn =
    "size-8 rounded-none border-0 bg-popover text-secondary-foreground hover:bg-accent";
  return (
    <div
      role="group"
      aria-label="Zoom"
      className="flex flex-col overflow-hidden rounded-md border border-border shadow-overlay [&>button+button]:border-t [&>button+button]:border-border"
    >
      <Button
        variant="outline"
        size="icon"
        className={btn}
        aria-label="Zoom in"
        onClick={onZoomIn}
        disabled={disabled}
      >
        <Plus aria-hidden="true" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className={btn}
        aria-label="Zoom out"
        onClick={onZoomOut}
        disabled={disabled}
      >
        <Minus aria-hidden="true" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className={btn}
        aria-label="Fit graph (F)"
        onClick={onFit}
        disabled={disabled}
      >
        <Maximize aria-hidden="true" />
      </Button>
    </div>
  );
}
