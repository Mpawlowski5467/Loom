import type { ChangeEvent, ReactNode } from "react";
import { useApp } from "../../context/app-ctx";
import { GRAPH_DISPLAY_RANGES } from "../../context/app-ctx";

interface RowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  readout: string;
  onChange: (v: number) => void;
}

function Row({
  label,
  value,
  min,
  max,
  step,
  readout,
  onChange,
}: RowProps): ReactNode {
  const handle = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(Number(e.target.value));
  };
  return (
    <div className="graph-display-row">
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
        className="graph-display-range"
        aria-label={label}
      />
    </div>
  );
}

export function DisplayControls(): ReactNode {
  const { graphDisplay, setGraphDisplay, resetGraphDisplay } = useApp();

  return (
    <div className="graph-display-panel">
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
        label="Labels"
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
