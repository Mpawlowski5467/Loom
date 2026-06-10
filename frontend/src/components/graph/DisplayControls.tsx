import type { ChangeEvent, ReactNode } from "react";
import { useApp } from "../../context/app-ctx";
import { GRAPH_DISPLAY_RANGES } from "../../context/app-ctx";
import { ORBIT_SCENES, ORBIT_SCENE_LABELS } from "../../graph/orbitScenes";

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
}: RowProps): ReactNode {
  const handle = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(Number(e.target.value));
  };
  return (
    <div
      className="graph-display-row"
      data-disabled={disabled ? "true" : undefined}
    >
      <div className="graph-display-row-head">
        <label>{label}</label>
        <span className="graph-display-readout">{readout}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handle}
        disabled={disabled}
        className="graph-display-range"
        aria-label={label}
      />
    </div>
  );
}

interface ToggleRowProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleRow({ label, checked, onChange }: ToggleRowProps): ReactNode {
  return (
    <div className="graph-display-row">
      <div className="graph-display-row-head">
        <label>{label}</label>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          className="graph-display-toggle"
          data-on={checked ? "true" : "false"}
          onClick={() => onChange(!checked)}
        >
          <span className="graph-display-toggle-thumb" />
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="graph-display-section">
      <h4 className="graph-display-section-heading">{title}</h4>
      {children}
    </div>
  );
}

export function DisplayControls(): ReactNode {
  const { graphDisplay, setGraphDisplay, resetGraphDisplay } = useApp();

  const labelsDisabled = !graphDisplay.labelsEnabled;
  const travelersDisabled = !graphDisplay.travelersEnabled;

  const labelShowReadout =
    graphDisplay.labelShowRatio >= 3.5
      ? "always"
      : `${graphDisplay.labelShowRatio.toFixed(1)}×`;

  return (
    <div className="graph-display-panel">
      <Section title="Labels">
        <ToggleRow
          label="Show labels"
          checked={graphDisplay.labelsEnabled}
          onChange={(v) => setGraphDisplay({ labelsEnabled: v })}
        />
        <Row
          label="Size"
          value={graphDisplay.labelSize}
          min={GRAPH_DISPLAY_RANGES.labelSize.min}
          max={GRAPH_DISPLAY_RANGES.labelSize.max}
          step={GRAPH_DISPLAY_RANGES.labelSize.step}
          readout={`${graphDisplay.labelSize} px`}
          onChange={(v) => setGraphDisplay({ labelSize: v })}
          disabled={labelsDisabled}
        />
        <Row
          label="Show from zoom"
          value={graphDisplay.labelShowRatio}
          min={GRAPH_DISPLAY_RANGES.labelShowRatio.min}
          max={GRAPH_DISPLAY_RANGES.labelShowRatio.max}
          step={GRAPH_DISPLAY_RANGES.labelShowRatio.step}
          readout={labelShowReadout}
          onChange={(v) => setGraphDisplay({ labelShowRatio: v })}
          disabled={labelsDisabled}
        />
        <Row
          label="Density"
          value={graphDisplay.labelThreshold}
          min={GRAPH_DISPLAY_RANGES.labelThreshold.min}
          max={GRAPH_DISPLAY_RANGES.labelThreshold.max}
          step={GRAPH_DISPLAY_RANGES.labelThreshold.step}
          readout={
            graphDisplay.labelThreshold <= 2
              ? "always"
              : graphDisplay.labelThreshold >= 19
                ? "off"
                : `${graphDisplay.labelThreshold}`
          }
          onChange={(v) => setGraphDisplay({ labelThreshold: v })}
          disabled={labelsDisabled}
        />
      </Section>

      <Section title="Nodes & spacing">
        <Row
          label="Node size"
          value={graphDisplay.nodeSizeScale}
          min={GRAPH_DISPLAY_RANGES.nodeSizeScale.min}
          max={GRAPH_DISPLAY_RANGES.nodeSizeScale.max}
          step={GRAPH_DISPLAY_RANGES.nodeSizeScale.step}
          readout={`${graphDisplay.nodeSizeScale.toFixed(1)}×`}
          onChange={(v) => setGraphDisplay({ nodeSizeScale: v })}
        />
        <Row
          label="Spacing"
          value={graphDisplay.spacingScale}
          min={GRAPH_DISPLAY_RANGES.spacingScale.min}
          max={GRAPH_DISPLAY_RANGES.spacingScale.max}
          step={GRAPH_DISPLAY_RANGES.spacingScale.step}
          readout={`${graphDisplay.spacingScale.toFixed(1)}×`}
          onChange={(v) => setGraphDisplay({ spacingScale: v })}
        />
        <ToggleRow
          label="Breathing"
          checked={graphDisplay.breathingEnabled}
          onChange={(v) => setGraphDisplay({ breathingEnabled: v })}
        />
        <ToggleRow
          label="Depth"
          checked={graphDisplay.depthEnabled}
          onChange={(v) => setGraphDisplay({ depthEnabled: v })}
        />
      </Section>

      <Section title="Orbit scene">
        <div
          className="graph-scene-picker"
          role="radiogroup"
          aria-label="Orbit scene"
        >
          {ORBIT_SCENES.map((scene) => (
            <button
              key={scene}
              type="button"
              role="radio"
              aria-checked={graphDisplay.orbitScene === scene}
              className="graph-scene-chip"
              data-active={graphDisplay.orbitScene === scene ? "true" : undefined}
              onClick={() => setGraphDisplay({ orbitScene: scene })}
            >
              {ORBIT_SCENE_LABELS[scene]}
            </button>
          ))}
        </div>
        <ToggleRow
          label="Auto-cycle"
          checked={graphDisplay.orbitAutoCycle}
          onChange={(v) => setGraphDisplay({ orbitAutoCycle: v })}
        />
      </Section>

      <Section title="Edges & motion">
        <Row
          label="Edge thickness"
          value={graphDisplay.edgeThickness}
          min={GRAPH_DISPLAY_RANGES.edgeThickness.min}
          max={GRAPH_DISPLAY_RANGES.edgeThickness.max}
          step={GRAPH_DISPLAY_RANGES.edgeThickness.step}
          readout={`${graphDisplay.edgeThickness.toFixed(1)}×`}
          onChange={(v) => setGraphDisplay({ edgeThickness: v })}
        />
        <ToggleRow
          label="Travelers"
          checked={graphDisplay.travelersEnabled}
          onChange={(v) => setGraphDisplay({ travelersEnabled: v })}
        />
        <Row
          label="Speed"
          value={graphDisplay.travelerPace}
          min={GRAPH_DISPLAY_RANGES.travelerPace.min}
          max={GRAPH_DISPLAY_RANGES.travelerPace.max}
          step={GRAPH_DISPLAY_RANGES.travelerPace.step}
          readout={
            graphDisplay.travelerPace === 0
              ? "off"
              : `${graphDisplay.travelerPace.toFixed(1)}×`
          }
          onChange={(v) => setGraphDisplay({ travelerPace: v })}
          disabled={travelersDisabled}
        />
      </Section>

      <button
        type="button"
        className="graph-display-reset"
        onClick={resetGraphDisplay}
      >
        Reset
      </button>
    </div>
  );
}
