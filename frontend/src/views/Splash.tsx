import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { LoomMark } from "../components/primitives/LoomMark";

interface Props {
  onDone: () => void;
}

export function Splash({ onDone }: Props): ReactNode {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const settle = setTimeout(() => setFading(true), 3000);
    const done = setTimeout(() => onDone(), 3600);
    return () => {
      clearTimeout(settle);
      clearTimeout(done);
    };
  }, [onDone]);

  return (
    <div
      className={`splash ${fading ? "splash-2" : ""}`}
      onClick={() => onDone()}
      role="presentation"
    >
      {/* Corner brackets */}
      <span className="splash-corner tl" aria-hidden="true" />
      <span className="splash-corner tr" aria-hidden="true" />
      <span className="splash-corner bl" aria-hidden="true" />
      <span className="splash-corner br" aria-hidden="true" />

      <div className="splash-stack">
        <div className="splash-loom-wrap">
          <LoomMark size={148} dur={2.6} loop color="var(--ink)" />
        </div>

        <div className="splash-wordmark-row">
          <span className="splash-wordmark">Loom</span>
          <span className="splash-version">v0.3.0</span>
        </div>

        <div className="splash-rail" aria-hidden="true">
          <span className="splash-rail-bar" />
        </div>

        <div className="splash-tag">
          <span className="splash-blink-dot" aria-hidden="true" />
          <span>preparing your weave</span>
        </div>
      </div>
    </div>
  );
}
