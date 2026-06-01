/*
Frontend testing conventions: render, assert visible output; prefer getByRole.
*/
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { UnindexedBanner } from "./UnindexedBanner";

describe("UnindexedBanner", () => {
  it("shows the count and pluralizes for multiple notes", () => {
    render(<UnindexedBanner count={3} />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("3 notes not yet indexed");
    expect(banner).toHaveTextContent("rebuilding search");
  });

  it("uses the singular noun for a single note", () => {
    render(<UnindexedBanner count={1} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 note not yet indexed",
    );
  });

  it("carries the banner-unindexed variant class", () => {
    const { container } = render(<UnindexedBanner count={2} />);
    expect(container.querySelector(".banner-unindexed")).not.toBeNull();
  });
});
