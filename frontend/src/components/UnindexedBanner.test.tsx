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

  it("is a single status region whose icon stays out of its text", () => {
    render(<UnindexedBanner count={2} />);
    const banners = screen.getAllByRole("status");
    expect(banners).toHaveLength(1);
    expect(banners[0]).toHaveTextContent(
      /^2 notes not yet indexed — rebuilding search…$/,
    );
  });
});
