/*
Frontend testing conventions:
- Test behavior, not implementation: render, interact, assert visible output.
- Props are spies; the type filters are compact dot toggles with accessible names.
*/
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GraphToolbar } from "./GraphToolbar";

const TYPE_NAMES = ["project", "topic", "people", "daily", "capture", "custom"];

function renderToolbar(filters: string[] = []) {
  const toggleGraphFilter = vi.fn();
  const clearGraphFilters = vi.fn();
  const onExport = vi.fn();
  render(
    <GraphToolbar
      graphFilters={new Set(filters)}
      toggleGraphFilter={toggleGraphFilter}
      clearGraphFilters={clearGraphFilters}
      onExport={onExport}
    />,
  );
  return { toggleGraphFilter, clearGraphFilters, onExport };
}

describe("GraphToolbar — type filters", () => {
  it("renders one compact toggle per note type with an accessible name", () => {
    renderToolbar();
    for (const name of TYPE_NAMES) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("reflects active filters via aria-pressed", () => {
    renderToolbar(["topic", "people"]);
    expect(screen.getByRole("button", { name: "topic" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "people" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "project" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("clicking a toggle flips that type's filter", async () => {
    const user = userEvent.setup();
    const { toggleGraphFilter } = renderToolbar();
    await user.click(screen.getByRole("button", { name: "daily" }));
    expect(toggleGraphFilter).toHaveBeenCalledWith("daily");
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
