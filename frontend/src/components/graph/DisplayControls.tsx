import { ChevronRight, RotateCcw } from "lucide-react";
import { useId, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import {
  GRAPH_DISPLAY_RANGES,
  GRAPH_LAYOUTS,
  GRAPH_LAYOUT_LABELS,
  useApp,
} from "../../context/app-ctx";
import type { GraphLayout } from "../../data/types";

interface RowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  readout: string;
  onChange: (v: number) => void;
  disabled?: boolean;
}

function Row({
  label,
  value,
  min,
  max,
  step,
  readout,
  onChange,
  disabled,
}: RowProps) {
  return (
    <div className={cn("flex flex-col gap-2", disabled && "opacity-50")}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-secondary-foreground">{label}</span>
        <span className="font-mono text-muted-foreground tabular-nums">
          {readout}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={([v]) => onChange(v!)}
        aria-label={label}
      />
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div
      className={cn(
        "flex items-center justify-between",
        disabled && "opacity-50",
      )}
    >
      <Label
        htmlFor={id}
        className="text-xs font-normal text-secondary-foreground"
      >
        {label}
      </Label>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label={label}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h4 className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
        {title}
      </h4>
      {children}
    </section>
  );
}

/** Graph presentation: layout scene plus labels, nodes, edges and motion. */
export function DisplayControls(): ReactNode {
  const { graphDisplay: d, setGraphDisplay: set, resetGraphDisplay } = useApp();
  const labelsOff = !d.labelsEnabled;

  return (
    <div className="flex w-72 flex-col gap-4">
      <Section title="Layout">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Layout"
          value={d.layout}
          onValueChange={(v) => v && set({ layout: v as GraphLayout })}
          className="flex w-full flex-wrap"
          role="radiogroup"
        >
          {GRAPH_LAYOUTS.map((layout) => (
            <ToggleGroupItem
              key={layout}
              value={layout}
              className="flex-1 px-2 text-xs"
            >
              {GRAPH_LAYOUT_LABELS[layout]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleRow
          label="Cycle layouts"
          checked={d.layoutAutoCycle}
          onChange={(v) => set({ layoutAutoCycle: v })}
          disabled={d.layout === "force"}
        />
      </Section>
      <Collapsible className="group/advanced flex flex-col gap-4">
        <CollapsibleTrigger className="flex items-center gap-1 rounded-sm text-xs font-medium text-secondary-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <ChevronRight
            aria-hidden="true"
            className="size-3.5 transition-transform group-data-[state=open]/advanced:rotate-90"
          />
          Advanced presentation
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-5">
          <Section title="Labels">
            <ToggleRow
              label="Show labels"
              checked={d.labelsEnabled}
              onChange={(v) => set({ labelsEnabled: v })}
            />
            <Row
              label="Size"
              value={d.labelSize}
              {...GRAPH_DISPLAY_RANGES.labelSize}
              readout={`${d.labelSize} px`}
              onChange={(v) => set({ labelSize: v })}
              disabled={labelsOff}
            />
            <Row
              label="Show from zoom"
              value={d.labelShowRatio}
              {...GRAPH_DISPLAY_RANGES.labelShowRatio}
              readout={
                d.labelShowRatio >= 3.5
                  ? "always"
                  : `${d.labelShowRatio.toFixed(1)}×`
              }
              onChange={(v) => set({ labelShowRatio: v })}
              disabled={labelsOff}
            />
            <Row
              label="Density"
              value={d.labelThreshold}
              {...GRAPH_DISPLAY_RANGES.labelThreshold}
              readout={
                d.labelThreshold <= 2
                  ? "always"
                  : d.labelThreshold >= 19
                    ? "off"
                    : `${d.labelThreshold}`
              }
              onChange={(v) => set({ labelThreshold: v })}
              disabled={labelsOff}
            />
          </Section>
          <Section title="Nodes & spacing">
            <Row
              label="Node size"
              value={d.nodeSizeScale}
              {...GRAPH_DISPLAY_RANGES.nodeSizeScale}
              readout={`${d.nodeSizeScale.toFixed(1)}×`}
              onChange={(v) => set({ nodeSizeScale: v })}
            />
            <Row
              label="Spacing"
              value={d.spacingScale}
              {...GRAPH_DISPLAY_RANGES.spacingScale}
              readout={`${d.spacingScale.toFixed(1)}×`}
              onChange={(v) => set({ spacingScale: v })}
            />
            <ToggleRow
              label="Breathing"
              checked={d.breathingEnabled}
              onChange={(v) => set({ breathingEnabled: v })}
            />
            <ToggleRow
              label="Depth"
              checked={d.depthEnabled}
              onChange={(v) => set({ depthEnabled: v })}
            />
          </Section>
          <Section title="Edges & motion">
            <Row
              label="Edge thickness"
              value={d.edgeThickness}
              {...GRAPH_DISPLAY_RANGES.edgeThickness}
              readout={`${d.edgeThickness.toFixed(1)}×`}
              onChange={(v) => set({ edgeThickness: v })}
            />
            <ToggleRow
              label="Travelers"
              checked={d.travelersEnabled}
              onChange={(v) => set({ travelersEnabled: v })}
            />
            <Row
              label="Speed"
              value={d.travelerPace}
              {...GRAPH_DISPLAY_RANGES.travelerPace}
              readout={
                d.travelerPace === 0 ? "off" : `${d.travelerPace.toFixed(1)}×`
              }
              onChange={(v) => set({ travelerPace: v })}
              disabled={!d.travelersEnabled}
            />
          </Section>
          <Button
            variant="ghost"
            size="sm"
            className="w-fit"
            onClick={resetGraphDisplay}
          >
            <RotateCcw aria-hidden="true" />
            Reset display settings
          </Button>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
