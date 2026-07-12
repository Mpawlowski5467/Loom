/*
Frontend testing conventions:
- Test behavior, not implementation: render, interact, assert visible output.
- Props are spies; the type filters are compact dot toggles with accessible names.
*/
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { NodeType } from "../../data/types";
import { GraphToolbar } from "./GraphToolbar";

const TYPE_NAMES: NodeType[] = [
  "project",
  "topic",
  "people",
  "daily",
  "capture",
  "custom",
];

function renderToolbar(filters: NodeType[] = []) {
  const toggleGraphFilter = vi.fn();
  const clearGraphFilters = vi.fn();
  const onExport = vi.fn();
  const onFitView = vi.fn();
  render(
    <GraphToolbar
      graphFilters={new Set(filters)}
      toggleGraphFilter={toggleGraphFilter}
      clearGraphFilters={clearGraphFilters}
      onExport={onExport}
      onFitView={onFitView}
    />,
  );
  return { toggleGraphFilter, clearGraphFilters, onExport, onFitView };
}

describe("GraphToolbar — type filters", () => {
  it("fits the currently visible graph from the right-side control", async () => {
    const user = userEvent.setup();
    const { onFitView } = renderToolbar();
    await user.click(screen.getByRole("button", { name: "Fit visible nodes" }));
    expect(onFitView).toHaveBeenCalledTimes(1);
  });
  it("renders one compact toggle per note type with an accessible name", () => {
    renderToolbar();
    for (const name of TYPE_NAMES) {
      expect(
        screen.getByRole("button", {
          name: `Show only ${name} notes (0)`,
        }),
      ).toBeInTheDocument();
    }
  });

  it("reflects active filters via aria-pressed", () => {
    renderToolbar(["topic", "people"]);
    expect(
      screen.getByRole("button", { name: "Hide topic notes (0)" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Hide people notes (0)" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Show project notes (0)" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking a toggle flips that type's filter", async () => {
    const user = userEvent.setup();
    const { toggleGraphFilter } = renderToolbar();
    await user.click(
      screen.getByRole("button", { name: "Show only daily notes (0)" }),
    );
    expect(toggleGraphFilter).toHaveBeenCalledWith("daily");
  });

  it("explains that toggling the sole selection restores every type", () => {
    renderToolbar(["topic"]);
    expect(
      screen.getByRole("button", { name: "Show all note types (0)" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("hides the clear affordance while no filter is active", () => {
    renderToolbar();
    expect(
      screen.queryByRole("button", { name: "Clear filters" }),
    ).not.toBeInTheDocument();
  });

  it("shows a clear button when filters are active and it empties the set", async () => {
    const user = userEvent.setup();
    const { clearGraphFilters } = renderToolbar(["topic"]);
    const clear = screen.getByRole("button", { name: "Clear filters" });
    await user.click(clear);
    expect(clearGraphFilters).toHaveBeenCalledTimes(1);
  });

  it("no longer renders the constellation/orbit mode toggle", () => {
    renderToolbar();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });
});
