import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "../../data/types";
import {
  GraphSelectionCard,
  type GraphSelectionCardProps,
} from "./GraphSelectionCard";

const note: Pick<Note, "title" | "type" | "tags"> = {
  title: "Caching",
  type: "topic",
  tags: ["infra", "performance", "backend", "hidden-fourth"],
};

function renderCard(overrides: Partial<GraphSelectionCardProps> = {}) {
  const props: GraphSelectionCardProps = {
    note,
    connectionCount: 4,
    neighborsOnly: false,
    onNeighborsOnlyChange: vi.fn(),
    onOpenNote: vi.fn(),
    onClearSelection: vi.fn(),
    ...overrides,
  };
  render(<GraphSelectionCard {...props} />);
  return props;
}

describe("GraphSelectionCard", () => {
  it("labels the detail card and renders its node metadata", () => {
    renderCard();

    const card = screen.getByRole("complementary", {
      name: "Node details: Caching",
    });
    expect(within(card).getByRole("heading", { name: "Caching" })).toHaveClass(
      "serif",
    );
    expect(within(card).getByText("topic")).toBeInTheDocument();
    expect(within(card).getByText("4 connections")).toHaveClass("mono");

    const tags = within(card).getByRole("list", { name: "Tags" });
    expect(within(tags).getAllByRole("listitem")).toHaveLength(3);
    expect(within(tags).getByText("#infra")).toBeInTheDocument();
    expect(within(tags).queryByText("#hidden-fourth")).not.toBeInTheDocument();
  });

  it("uses the singular connection label", () => {
    renderCard({ connectionCount: 1 });
    expect(screen.getByText("1 connection")).toBeInTheDocument();
  });

  it("opens the note and clears selection through labelled buttons", async () => {
    const user = userEvent.setup();
    const onCenterNode = vi.fn();
    const props = renderCard({ onCenterNode });

    await user.click(screen.getByRole("button", { name: "Center" }));
    await user.click(screen.getByRole("button", { name: "Open note" }));
    await user.click(
      screen.getByRole("button", { name: "Clear node selection" }),
    );

    expect(onCenterNode).toHaveBeenCalledTimes(1);
    expect(props.onOpenNote).toHaveBeenCalledTimes(1);
    expect(props.onClearSelection).toHaveBeenCalledTimes(1);
  });

  it("exposes a native switch and reports its next checked state", async () => {
    const user = userEvent.setup();
    const onNeighborsOnlyChange = vi.fn();
    renderCard({ neighborsOnly: true, onNeighborsOnlyChange });

    const toggle = screen.getByRole("switch", {
      name: "Show selected note and direct neighbors only",
    });
    expect(toggle).toBeInstanceOf(HTMLInputElement);
    expect(toggle).toHaveAttribute("type", "checkbox");
    expect(toggle).toBeChecked();

    await user.click(toggle);
    expect(onNeighborsOnlyChange).toHaveBeenCalledWith(false);
  });
});
