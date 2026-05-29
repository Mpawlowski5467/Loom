import { useState } from "react";
import type { ReactNode } from "react";
import type { BoardMode } from "../data/types";
import { ModeToggle } from "../components/primitives/ModeToggle";
import { StatusBadge } from "../components/primitives/StatusBadge";
import { Council } from "../components/Council";
import { TraceFeed } from "../components/TraceFeed";
import { CardsMode } from "./board/CardsMode";
import { PulseMode } from "./board/PulseMode";
import { RoundTableModal } from "./board/RoundTableModal";

export function BoardView(): ReactNode {
  const [viz, setViz] = useState<BoardMode>("cards");
  const [rtOpen, setRtOpen] = useState(false);

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
          <button
            type="button"
            className="btn btn-md"
            onClick={() => setRtOpen(true)}
          >
            <span aria-hidden="true">◯</span>
            <span>round table</span>
          </button>
          <ModeToggle
            value={viz}
            onChange={setViz}
            ariaLabel="Agent view"
            options={[
              { value: "cards", icon: "▦", label: "cards" },
              { value: "pulse", icon: "∿", label: "pulse" },
            ]}
          />
        </div>
        <div key={viz} className="board-mode-content">
          {viz === "cards" ? <CardsMode /> : <PulseMode />}
        </div>
      </div>
      <div className="board-sidebar">
        <TraceFeed />
      </div>
      <Council />
      {rtOpen && <RoundTableModal onClose={() => setRtOpen(false)} />}
    </div>
  );
}
