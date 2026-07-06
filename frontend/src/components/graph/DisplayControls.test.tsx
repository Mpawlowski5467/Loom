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

describe("DisplayControls — layout picker", () => {
  it("renders all six layouts with the selection checked", () => {
    renderControls({ layout: "galaxy" });
    const group = screen.getByRole("radiogroup", { name: "Layout" });
    expect(group).toBeInTheDocument();
    for (const label of ["Force", "Rings", "Spiral", "Arms", "Galaxy", "Wave"]) {
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("radio", { name: "Galaxy" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Force" })).not.toBeChecked();
  });

  it("picking a layout updates the display settings", async () => {
    const user = userEvent.setup();
    const { setGraphDisplay } = renderControls();
    await user.click(screen.getByRole("radio", { name: "Wave" }));
    expect(setGraphDisplay).toHaveBeenCalledWith({ layout: "wave" });
  });

  it("cycle layouts is a switch that toggles layoutAutoCycle", async () => {
    const user = userEvent.setup();
    const { setGraphDisplay } = renderControls({
      layout: "rings",
      layoutAutoCycle: false,
    });
    const toggle = screen.getByRole("switch", { name: "Cycle layouts" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.click(toggle);
    expect(setGraphDisplay).toHaveBeenCalledWith({ layoutAutoCycle: true });
  });

  it("cycle layouts is disabled while the force layout is selected", async () => {
    const user = userEvent.setup();
    const { setGraphDisplay } = renderControls({ layout: "force" });
    const toggle = screen.getByRole("switch", { name: "Cycle layouts" });
    expect(toggle).toBeDisabled();
    await user.click(toggle);
    expect(setGraphDisplay).not.toHaveBeenCalled();
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
