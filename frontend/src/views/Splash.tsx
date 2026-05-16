import { useEffect, useState } from "react";
import type { ReactNode } from "react";

const WARP_COUNT = 5;
const WEFT_COUNT = 4;

interface Props {
  onDone: () => void;
}

export function Splash({ onDone }: Props): ReactNode {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const settle = setTimeout(() => setFading(true), 2400);
    const done = setTimeout(() => onDone(), 3000);
    return () => {
      clearTimeout(settle);
      clearTimeout(done);
    };
  }, [onDone]);

  const W = 600;
  const H = 240;
  const margin = 80;
  const warpSpacing = (W - margin * 2) / (WARP_COUNT - 1);
  const weftSpacing = (H - 60 - 80) / (WEFT_COUNT - 1);

  return (
    <div
      className={`splash ${fading ? "splash-2" : ""}`}
      onClick={() => onDone()}
      role="presentation"
    >
      <svg className="splash-loom" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        {/* warp (vertical, blue) */}
        {Array.from({ length: WARP_COUNT }, (_, i) => {
          const x = margin + i * warpSpacing;
          return (
            <line
              key={`w${i}`}
              className="splash-warp"
              x1={x}
              y1={40}
              x2={x}
              y2={H - 40}
              style={{ animationDelay: `${i * 90}ms` }}
            />
          );
        })}
        {/* weft (horizontal, red) */}
        {Array.from({ length: WEFT_COUNT }, (_, i) => {
          const y = 60 + i * weftSpacing;
          return (
            <line
              key={`f${i}`}
              className="splash-weft"
              x1={margin - 20}
              y1={y}
              x2={W - margin + 20}
              y2={y}
              style={{ animationDelay: `${500 + i * 90}ms` }}
            />
          );
        })}
        {/* knot dots */}
        {Array.from({ length: WARP_COUNT }, (_, wi) =>
          Array.from({ length: WEFT_COUNT }, (_, fi) => {
            const x = margin + wi * warpSpacing;
            const y = 60 + fi * weftSpacing;
            return (
              <circle
                key={`k${wi}-${fi}`}
                className="splash-knot"
                cx={x}
                cy={y}
                r={2}
                style={{ animationDelay: `${900 + (wi + fi) * 60}ms` }}
              />
            );
          }),
        )}
        {/* wordmark */}
        <text
          className="splash-wordmark"
          x={W / 2}
          y={H / 2 + 24}
          textAnchor="middle"
        >
          Loom
        </text>
        {/* shuttle thread across wordmark */}
        <line
          className="splash-shuttle"
          x1={margin}
          y1={H / 2 + 6}
          x2={W - margin}
          y2={H / 2 + 6}
        />
      </svg>
      <div className="splash-tag">A local-first knowledge system</div>
    </div>
  );
}
