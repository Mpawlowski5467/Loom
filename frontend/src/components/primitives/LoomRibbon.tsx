import type { ReactNode } from "react";

export function LoomRibbon(): ReactNode {
  return (
    <svg
      className="loom-ribbon"
      viewBox="0 0 1000 6"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <line
        x1="0"
        y1="3"
        x2="1000"
        y2="3"
        stroke="var(--agent)"
        strokeOpacity="0.18"
        strokeWidth="1"
      />
      <line
        x1="0"
        y1="3"
        x2="1000"
        y2="3"
        stroke="var(--agent)"
        strokeOpacity="0.55"
        strokeWidth="1"
        strokeDasharray="3 8"
        style={{ animation: "ribbonDash 2.2s linear infinite" }}
      />
    </svg>
  );
}
