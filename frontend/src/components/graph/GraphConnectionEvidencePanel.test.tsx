import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GraphConnectionEvidencePanel } from "./GraphConnectionEvidencePanel";

const connectionEvidence = vi.fn(() => <div>Filtered evidence</div>);
vi.mock("../ConnectionEvidence", () => ({
  ConnectionEvidence: (props: unknown) => connectionEvidence(props),
}));

describe("GraphConnectionEvidencePanel", () => {
  it("labels the selected relationship, filters evidence, and closes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <GraphConnectionEvidencePanel
        source={{ id: "source", title: "Source note" }}
        target={{ id: "target", title: "Target note" }}
        onClose={onClose}
      />,
    );

    expect(
      screen.getByRole("complementary", {
        name: "Connection evidence: Source note to Target note",
      }),
    ).toHaveTextContent("Source note → Target note");
    expect(connectionEvidence).toHaveBeenCalledWith({
      noteId: "source",
      pair: { sourceId: "source", targetId: "target" },
      emptyMessage: "No recorded evidence for this relationship.",
    });

    await user.click(
      screen.getByRole("button", { name: "Close connection evidence" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
