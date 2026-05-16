import React from "react";
import { render, screen } from "@testing-library/react";
import { SearchDropdown } from "../SearchDropdown";

describe("SearchDropdown", () => {
  it("renders the search input", () => {
    render(<SearchDropdown onSelect={vi.fn()} />);

    const input = screen.getByPlaceholderText("Search vault... (Ctrl+K)");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "text");
  });

  it("does not render dropdown initially", () => {
    const { container } = render(<SearchDropdown onSelect={vi.fn()} />);

    // The dropdown div only renders when `open` is true
    expect(container.querySelector("[class*='dropdown']")).not.toBeInTheDocument();
  });

  it("renders with an external inputRef", () => {
    const ref = { current: null };

    render(<SearchDropdown onSelect={vi.fn()} inputRef={ref} />);

    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });
});
