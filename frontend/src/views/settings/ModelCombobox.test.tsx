import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { ModelCombobox } from "./ModelCombobox";

/** A controlled wrapper so the input reflects typed text like the real parent. */
function Controlled({ options = OPTIONS }: { options?: string[] }) {
  const [value, setValue] = useState("");
  return (
    <ModelCombobox
      label="Chat model"
      value={value}
      options={options}
      onChange={setValue}
    />
  );
}

const OPTIONS = ["gpt-4o", "gpt-4o-mini", "gpt-4.1"];

function setup(props: Partial<Parameters<typeof ModelCombobox>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <ModelCombobox
      label="Chat model"
      value={props.value ?? ""}
      options={props.options ?? OPTIONS}
      disabled={props.disabled}
      onChange={onChange}
    />,
  );
  return { onChange };
}

describe("ModelCombobox", () => {
  it("renders a disabled placeholder field when disabled", () => {
    setup({ disabled: true });
    const input = screen.getByPlaceholderText("Unavailable");
    expect(input).toBeDisabled();
  });

  it("opens the full option list on focus", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByPlaceholderText("model name"));
    for (const opt of OPTIONS) {
      expect(screen.getByRole("button", { name: opt })).toBeInTheDocument();
    }
  });

  it("filters options as the user types", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.type(screen.getByPlaceholderText("model name"), "mini");
    // Only the matching option remains visible.
    expect(screen.getByRole("button", { name: "gpt-4o-mini" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "gpt-4.1" })).not.toBeInTheDocument();
  });

  it("shows only matching options for the current query", async () => {
    const user = userEvent.setup();
    // value is controlled by the parent; render with a query value directly.
    setup({ value: "mini" });
    await user.click(screen.getByDisplayValue("mini"));
    expect(screen.getByRole("button", { name: "gpt-4o-mini" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "gpt-4.1" })).not.toBeInTheDocument();
  });

  it("selecting an option reports it and closes the list", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByPlaceholderText("model name"));
    await user.click(screen.getByRole("button", { name: "gpt-4o" }));
    expect(onChange).toHaveBeenCalledWith("gpt-4o");
    expect(screen.queryByRole("button", { name: "gpt-4o-mini" })).not.toBeInTheDocument();
  });

  it("shows the whole list (not filtered) when the value is a complete option", async () => {
    const user = userEvent.setup();
    setup({ value: "gpt-4o" });
    await user.click(screen.getByDisplayValue("gpt-4o"));
    // Even though "gpt-4o" is typed, every option stays visible.
    expect(screen.getByRole("button", { name: "gpt-4o-mini" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "gpt-4.1" })).toBeInTheDocument();
  });

  it("hides the toggle and list when there are no options", () => {
    setup({ options: [] });
    expect(
      screen.queryByRole("button", { name: /Show Chat model options/ }),
    ).not.toBeInTheDocument();
  });

  it("closes the list on outside click", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <ModelCombobox label="Chat model" value="" options={OPTIONS} onChange={vi.fn()} />
        <button>outside</button>
      </div>,
    );
    await user.click(screen.getByPlaceholderText("model name"));
    expect(screen.getByRole("button", { name: "gpt-4o" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("button", { name: "gpt-4o" })).not.toBeInTheDocument();
  });
});
