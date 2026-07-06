import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { BoardView } from "./BoardView";

// BoardView is a layout shell: its own responsibility is the cards/pulse mode
// toggle. The heavy children (each context-bound + API-driven) are units of
// their own, so we stub them and assert which one BoardView mounts.
vi.mock("./board/CardsMode", () => ({
  CardsMode: () => <div data-testid="cards-mode">cards content</div>,
}));
vi.mock("./board/PulseMode", () => ({
  PulseMode: () => <div data-testid="pulse-mode">pulse content</div>,
}));
vi.mock("../components/Council", () => ({
  Council: () => <div data-testid="council" />,
}));

describe("BoardView", () => {
  it("renders the cards view by default", () => {
    render(<BoardView />);
    expect(screen.getByTestId("cards-mode")).toBeInTheDocument();
    expect(screen.queryByTestId("pulse-mode")).not.toBeInTheDocument();
  });

  it("marks the cards toggle as checked by default", () => {
    render(<BoardView />);
    expect(screen.getByRole("radio", { name: /cards/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /pulse/ })).not.toBeChecked();
  });

  it("switches to the pulse view when the pulse toggle is clicked", async () => {
    const user = userEvent.setup();
    render(<BoardView />);

    await user.click(screen.getByRole("radio", { name: /pulse/ }));

    expect(screen.getByTestId("pulse-mode")).toBeInTheDocument();
    expect(screen.queryByTestId("cards-mode")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /pulse/ })).toBeChecked();
  });

  it("switches back to cards from pulse", async () => {
    const user = userEvent.setup();
    render(<BoardView />);

    await user.click(screen.getByRole("radio", { name: /pulse/ }));
    await user.click(screen.getByRole("radio", { name: /cards/ }));

    expect(screen.getByTestId("cards-mode")).toBeInTheDocument();
    expect(screen.queryByTestId("pulse-mode")).not.toBeInTheDocument();
  });

  it("renders the status legend and the council panel without a trace sidebar", () => {
    const { container } = render(<BoardView />);
    expect(screen.getByLabelText("Status key")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("settling")).toBeInTheDocument();
    expect(screen.getByText("idle")).toBeInTheDocument();
    expect(screen.getByTestId("council")).toBeInTheDocument();
    // The page-level LLM-call sidebar is gone; .board-main takes the width.
    expect(container.querySelector(".board-sidebar")).toBeNull();
  });
});
