/*
Frontend testing conventions:
- Test behavior, not implementation: render, interact, assert visible output.
- Context fed through AppCtx.Provider; setGraphDisplay observed as a spy.
*/
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppCtx, GRAPH_DISPLAY_DEFAULTS } from "../../context/app-ctx";
import type { AppContextValue, GraphDisplay } from "../../context/app-ctx";
import { DisplayControls } from "./DisplayControls";

function renderControls(display: Partial<GraphDisplay> = {}) {
  const setGraphDisplay = vi.fn();
  const resetGraphDisplay = vi.fn();
  const value = {
    graphDisplay: { ...GRAPH_DISPLAY_DEFAULTS, ...display },
    setGraphDisplay,
    resetGraphDisplay,
  } as unknown as AppContextValue;

  function Harness(): ReactNode {
    return (
      <AppCtx.Provider value={value}>
        <DisplayControls />
      </AppCtx.Provider>
    );
  }
  render(<Harness />);
  return { setGraphDisplay, resetGraphDisplay };
}

describe("DisplayControls — orbit scene picker", () => {
  it("renders all five scenes with the selection checked", () => {
    renderControls({ orbitScene: "galaxy" });
    const group = screen.getByRole("radiogroup", { name: "Orbit scene" });
    expect(group).toBeInTheDocument();
    for (const label of ["Rings", "Spiral", "Arms", "Galaxy", "Wave"]) {
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("radio", { name: "Galaxy" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Rings" })).not.toBeChecked();
  });

  it("picking a scene updates the display settings", async () => {
    const user = userEvent.setup();
    const { setGraphDisplay } = renderControls();
    await user.click(screen.getByRole("radio", { name: "Wave" }));
    expect(setGraphDisplay).toHaveBeenCalledWith({ orbitScene: "wave" });
  });

  it("auto-cycle is a switch that toggles orbitAutoCycle", async () => {
    const user = userEvent.setup();
    const { setGraphDisplay } = renderControls({ orbitAutoCycle: false });
    const toggle = screen.getByRole("switch", { name: "Auto-cycle" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.click(toggle);
    expect(setGraphDisplay).toHaveBeenCalledWith({ orbitAutoCycle: true });
  });
});

describe("DisplayControls — depth toggle", () => {
  it("reflects and toggles depthEnabled", async () => {
    const user = userEvent.setup();
    const { setGraphDisplay } = renderControls({ depthEnabled: true });
    const toggle = screen.getByRole("switch", { name: "Depth" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await user.click(toggle);
    expect(setGraphDisplay).toHaveBeenCalledWith({ depthEnabled: false });
  });
});
