import { useId } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { AgentState } from "../../data/types";

// Map each agent to a theme token (not a frozen hex) so blobs re-color with the
// active theme — the paper-ink researcher blob was near-invisible on dark themes.
const AGENT_COLOR_VARS: Record<string, string> = {
  weaver: "--node-topic",
  spider: "--node-project",
  scribe: "--node-capture",
  archivist: "--node-people",
  sentinel: "--node-custom",
  researcher: "--ink-2",
  standup: "--you",
};

const AGENT_GLYPHS: Record<string, string> = {
  weaver: "🧶",
  spider: "🕸",
  scribe: "✍",
  archivist: "📚",
  sentinel: "🛡",
  researcher: "🔭",
  standup: "☀",
};

// 3 hand-tuned blob silhouettes, all viewBox 0 0 100 100
const BLOB_PATHS = [
  "M50,8 C72,8 92,28 92,50 C92,72 72,92 50,92 C28,92 8,72 8,50 C8,28 28,8 50,8 Z",
  "M50,10 C74,12 90,30 88,52 C86,74 70,90 48,88 C26,86 10,68 12,46 C14,24 28,10 50,10 Z",
  "M50,6 C70,10 94,26 90,50 C92,72 68,94 50,90 C30,94 8,72 10,50 C6,28 28,4 50,6 Z",
];

function charSeed(name: string): number {
  let s = 0;
  for (let i = 0; i < name.length; i++) s += name.charCodeAt(i);
  return s;
}

interface AgentBlobProps {
  agent: string;
  state?: AgentState;
  size?: number;
  showGlyph?: boolean;
}

export function AgentBlob({
  agent,
  state = "idle",
  size = 36,
  showGlyph = true,
}: AgentBlobProps): ReactNode {
  const color = `var(${AGENT_COLOR_VARS[agent] ?? "--ink-2"})`;
  const glyph = AGENT_GLYPHS[agent] ?? "•";
  const seed = charSeed(agent);
  const begin = `-${(seed % 30) / 10}s`;
  const dur = state === "running" ? "3.2s" : state === "queued" ? "5s" : "6.8s";

  const wrap: CSSProperties = {
    width: size,
    height: size,
    position: "relative",
    display: "inline-block",
    flexShrink: 0,
  };

  const glyphSize = Math.max(10, Math.round(size * 0.42));
  const glyphStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: glyphSize,
    color: "#ffffff",
    filter: "grayscale(1) brightness(2.4) contrast(1.2)",
    pointerEvents: "none",
    userSelect: "none",
    lineHeight: 1,
  };

  return (
    <span className="agent-blob" style={wrap} aria-hidden="true">
      <svg
        viewBox="-10 -10 120 120"
        width={size}
        height={size}
        style={{ display: "block", overflow: "visible" }}
      >
        {state === "queued" && (
          <circle
            cx="50"
            cy="50"
            r="56"
            fill="none"
            stroke={color}
            strokeOpacity="0.35"
            strokeWidth="1"
            strokeDasharray="2 4"
            style={{
              transformOrigin: "50px 50px",
              animation: "rotateSlow 10s linear infinite",
            }}
          />
        )}
        <path d={BLOB_PATHS[0]} fill={color}>
          <animate
            attributeName="d"
            values={`${BLOB_PATHS[0]};${BLOB_PATHS[1]};${BLOB_PATHS[2]};${BLOB_PATHS[0]}`}
            dur={dur}
            begin={begin}
            repeatCount="indefinite"
            calcMode="spline"
            keySplines="0.4 0 0.6 1; 0.4 0 0.6 1; 0.4 0 0.6 1"
            keyTimes="0;0.33;0.66;1"
          />
        </path>
        {state === "running" && (
          <circle cx="50" cy="50" r="44" fill="none" stroke={color} strokeWidth="1.4">
            <animate
              attributeName="r"
              from="44"
              to="58"
              dur="2.6s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="stroke-opacity"
              from="0.5"
              to="0"
              dur="2.6s"
              repeatCount="indefinite"
            />
          </circle>
        )}
      </svg>
      {showGlyph && <span style={glyphStyle}>{glyph}</span>}
    </span>
  );
}

export function ThinkingBlob({ size = 36 }: { size?: number }): ReactNode {
  const filterId = `goo-${useId().replace(/[^a-z0-9]/gi, "")}`;
  return (
    <span
      className="thinking-blob"
      style={{
        width: size,
        height: size,
        display: "inline-block",
        flexShrink: 0,
      }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <defs>
          <filter id={filterId}>
            <feGaussianBlur stdDeviation="3" />
            <feColorMatrix
              values="1 0 0 0 0
                      0 1 0 0 0
                      0 0 1 0 0
                      0 0 0 18 -7"
            />
          </filter>
        </defs>
        <g filter={`url(#${filterId})`} fill="var(--ink)">
          <circle cx="30" cy="50">
            <animate
              attributeName="r"
              values="8;5;8"
              dur="1.4s"
              repeatCount="indefinite"
            />
          </circle>
          <circle cx="50" cy="50">
            <animate
              attributeName="r"
              values="8;5;8"
              dur="1.4s"
              begin="-0.2s"
              repeatCount="indefinite"
            />
          </circle>
          <circle cx="70" cy="50">
            <animate
              attributeName="r"
              values="8;5;8"
              dur="1.4s"
              begin="-0.4s"
              repeatCount="indefinite"
            />
          </circle>
        </g>
      </svg>
    </span>
  );
}
