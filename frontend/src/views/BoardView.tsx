import { useState } from "react";
import type { ReactNode } from "react";
import type { BoardMode } from "../data/types";
import { ModeToggle } from "../components/primitives/ModeToggle";
import { StatusBadge } from "../components/primitives/StatusBadge";
import { Council } from "../components/Council";
import { CardsMode } from "./board/CardsMode";
import { PulseMode } from "./board/PulseMode";

export function BoardView(): ReactNode {
  const [viz, setViz] = useState<BoardMode>("cards");

  return (
    <div className="board-view">
      <div className="board-main">
        <div className="board-toolbar">
          <div className="board-h">Agents</div>
          <div className="board-status-legend" aria-label="Status key">
            <StatusBadge state="running" label="running" />
            <StatusBadge state="idle" label="settling" />
            <StatusBadge state="idle" label="idle" />
          </div>
        </div>
        <details className="board-advanced-viz">
          <summary>Advanced visualization</summary>
          <ModeToggle
            value={viz}
            onChange={setViz}
            ariaLabel="Agent view"
            options={[
              { value: "cards", icon: "▦", label: "cards" },
              { value: "pulse", icon: "∿", label: "pulse" },
            ]}
          />
        </details>
        <div key={viz} className="board-mode-content">
          {viz === "cards" ? <CardsMode /> : <PulseMode />}
        </div>
      </div>
      <Council />
    </div>
  );
}
