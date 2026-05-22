import type { ReactNode } from "react";

interface LoomMarkProps {
  size?: number;
  /** Draw cycle duration in seconds (6 = nav loop, 2.6 = splash intro). */
  dur?: number;
  /** Loop the draw animation. False = play once (for splash intro). */
  loop?: boolean;
  color?: string;
}

const ELLIPSE_PATH =
  "M40 100 C 40 40, 160 40, 160 100 C 160 160, 40 160, 40 100 Z";
const WEAVE_PATH = "M100 40 C 160 100, 40 100, 100 160";

const ELLIPSE_LEN = 380;
const WEAVE_LEN = 220;

export function LoomMark({
  size = 20,
  dur = 6,
  loop = true,
  color = "currentColor",
}: LoomMarkProps): ReactNode {
  const repeat = loop ? "indefinite" : "1";

  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      style={{ display: "block", overflow: "visible" }}
      aria-hidden="true"
    >
      {/* Echo copy at low opacity */}
      <g opacity="0.16">
        <path
          d={ELLIPSE_PATH}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
        />
        <path
          d={WEAVE_PATH}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
        />
      </g>
      {/* Animated ellipse */}
      <path
        d={ELLIPSE_PATH}
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={ELLIPSE_LEN}
      >
        <animate
          attributeName="stroke-dashoffset"
          values={`${ELLIPSE_LEN};0;0;${ELLIPSE_LEN}`}
          keyTimes="0;0.4;0.6;1"
          dur={`${dur}s`}
          repeatCount={repeat}
          fill="freeze"
        />
      </path>
      {/* Animated weave */}
      <path
        d={WEAVE_PATH}
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={WEAVE_LEN}
      >
        <animate
          attributeName="stroke-dashoffset"
          values={`${WEAVE_LEN};${WEAVE_LEN};0;0;${WEAVE_LEN}`}
          keyTimes="0;0.3;0.5;0.7;1"
          dur={`${dur}s`}
          repeatCount={repeat}
          fill="freeze"
        />
      </path>
    </svg>
  );
}
