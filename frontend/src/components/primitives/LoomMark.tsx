import type { ReactNode } from "react";

interface LoomMarkProps {
  size?: number;
  /** Draw cycle duration in seconds (6 = nav loop, 2.6 = splash intro). */
  dur?: number;
  /** Loop the draw animation. False = play once (for splash intro). */
  loop?: boolean;
  color?: string;
  /** Accent color for the knot at the crossing (brick red by default). */
  accent?: string;
}

const FRAME_PATH =
  "M40 100 C 40 40, 164 40, 164 100 C 164 160, 40 160, 40 100 Z";
const THREAD_A_PATH = "M66 46 C 126 96, 78 104, 138 154";
const THREAD_B_PATH = "M138 46 C 78 96, 126 104, 66 154";

export function LoomMark({
  size = 20,
  dur = 6,
  loop = true,
  color = "currentColor",
  accent = "#a83a2c",
}: LoomMarkProps): ReactNode {
  const repeat = loop ? "indefinite" : "1";
  const sw = 7;

  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      style={{ display: "block", overflow: "visible" }}
      aria-hidden="true"
    >
      {/* Echo copy at low opacity */}
      <g
        opacity="0.14"
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={FRAME_PATH} />
        <path d={THREAD_A_PATH} />
        <path d={THREAD_B_PATH} />
      </g>

      {/* Animated frame */}
      <path
        d={FRAME_PATH}
        pathLength={100}
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="100"
      >
        <animate
          attributeName="stroke-dashoffset"
          values="100;0;0;100"
          keyTimes="0;0.35;0.7;1"
          dur={`${dur}s`}
          repeatCount={repeat}
          fill="freeze"
        />
      </path>

      {/* Thread A — top-left to bottom-right */}
      <path
        d={THREAD_A_PATH}
        pathLength={100}
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeDasharray="100"
      >
        <animate
          attributeName="stroke-dashoffset"
          values="100;100;0;0;100"
          keyTimes="0;0.3;0.55;0.7;1"
          dur={`${dur}s`}
          repeatCount={repeat}
          fill="freeze"
        />
      </path>

      {/* Thread B — top-right to bottom-left */}
      <path
        d={THREAD_B_PATH}
        pathLength={100}
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeDasharray="100"
      >
        <animate
          attributeName="stroke-dashoffset"
          values="100;100;0;0;100"
          keyTimes="0;0.3;0.55;0.7;1"
          dur={`${dur}s`}
          repeatCount={repeat}
          fill="freeze"
        />
      </path>

      {/* Accent knot at the crossing */}
      <circle cx="102" cy="100" r="5.5" fill={accent} opacity="0">
        <animate
          attributeName="opacity"
          values="0;0;1;1;0"
          keyTimes="0;0.5;0.6;0.7;1"
          dur={`${dur}s`}
          repeatCount={repeat}
          fill="freeze"
        />
      </circle>
    </svg>
  );
}
