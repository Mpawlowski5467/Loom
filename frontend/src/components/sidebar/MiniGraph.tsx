import { useMemo } from "react";
import type { ReactNode } from "react";
import { useApp } from "../../context/app-ctx";
import type { NodeType } from "../../data/types";

const COLOR: Record<NodeType, string> = {
  project: "#2d4a7c",
  topic: "#4a6b3a",
  people: "#6b3a6b",
  daily: "#8c877d",
  capture: "#a8722a",
  custom: "#2d6b6b",
};

interface Props {
  focusId: string;
}

export function MiniGraph({ focusId }: Props): ReactNode {
  const { noteById, backlinksFor, openNote } = useApp();
  const focus = noteById(focusId);

  const neighbors = useMemo(() => {
    if (!focus) return [];
    const ids = new Set<string>([...focus.links, ...backlinksFor(focus.id)]);
    return Array.from(ids)
      .map((id) => noteById(id))
      .filter((n): n is NonNullable<typeof n> => !!n)
      .slice(0, 10);
  }, [focus, noteById, backlinksFor]);

  if (!focus) return null;

  const cx = 130;
  const cy = 90;
  const r = 60;

  return (
    <svg viewBox="0 0 260 180" className="mini-graph" aria-hidden="true">
      {neighbors.map((n, i) => {
        const a = (i / neighbors.length) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        return (
          <line
            key={`l${n.id}`}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke="rgba(26,24,21,0.18)"
            strokeWidth={1}
          />
        );
      })}
      {/* focus ripple */}
      <circle
        cx={cx}
        cy={cy}
        r={6}
        fill="none"
        stroke="var(--you)"
        strokeWidth={1.5}
        opacity={0.6}
      >
        <animate
          attributeName="r"
          values="6;18"
          dur="2.2s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="opacity"
          values="0.6;0"
          dur="2.2s"
          repeatCount="indefinite"
        />
      </circle>
      {/* focus dot */}
      <circle cx={cx} cy={cy} r={5} fill="var(--you)" />
      <text
        x={cx}
        y={cy + 22}
        textAnchor="middle"
        fontSize="9"
        fontFamily="var(--mono)"
        fill="var(--ink-2)"
      >
        {focus.title}
      </text>
      {neighbors.map((n, i) => {
        const a = (i / neighbors.length) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        return (
          <g key={`n${n.id}`} style={{ cursor: "pointer" }} onClick={() => openNote(n.id)}>
            <circle cx={x} cy={y} r={3.5} fill={COLOR[n.type]} />
            <text
              x={x}
              y={y - 7}
              textAnchor="middle"
              fontSize="8.5"
              fontFamily="var(--font)"
              fill="var(--ink-2)"
            >
              {n.title.length > 14 ? n.title.slice(0, 13) + "…" : n.title}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
