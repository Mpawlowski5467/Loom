import { useState } from "react";
import type { ReactNode } from "react";
import type { BoardMode } from "../data/types";
import { ModeToggle } from "../components/primitives/ModeToggle";
import { Council } from "../components/Council";
import { CardsMode } from "./board/CardsMode";
import { RoundTableMode } from "./board/RoundTableMode";
import { PulseMode } from "./board/PulseMode";

export function BoardView(): ReactNode {
  const [mode, setMode] = useState<BoardMode>("cards");

  return (
    <div className="board-view">
      <div className="board-main">
        <div className="board-toolbar">
          <div className="board-h">Agents</div>
          <ModeToggle
            value={mode}
            onChange={setMode}
            ariaLabel="Board mode"
            options={[
              { value: "cards", icon: "▦", label: "cards" },
              { value: "round-table", icon: "◯", label: "round table" },
              { value: "pulse", icon: "∿", label: "pulse" },
            ]}
          />
        </div>
        {mode === "cards" && <CardsMode />}
        {mode === "round-table" && <RoundTableMode />}
        {mode === "pulse" && <PulseMode />}
      </div>
      <Council />
    </div>
  );
}
