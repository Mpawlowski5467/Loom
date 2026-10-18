import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionEvidence } from "./ConnectionEvidence";

const { getConnections, acceptConnection } = vi.hoisted(() => ({
  getConnections: vi.fn(),
  acceptConnection: vi.fn(),
}));
vi.mock("../api/connections", () => ({ getConnections, acceptConnection }));
const item = {
  direction: "outgoing",
  source_id: "s",
  target_id: "t",
  state: "suggested",
  method: "spider",
  rationale: "Shared terms: cache.",
  source_excerpt: "source excerpt",
  target_excerpt: "target excerpt",
  score: 0.7,
  created: "",
  agent: "spider",
  source_modified: "s1",
  target_modified: "t1",
};
beforeEach(() => {
  getConnections.mockReset();
  acceptConnection.mockReset();
});
describe("ConnectionEvidence", () => {
  it("reports unavailable evidence without claiming a relationship has none", async () => {
    getConnections.mockRejectedValue(
      new Error("Connection evidence unavailable"),
    );
    render(
      <ConnectionEvidence noteId="s" emptyMessage="No evidence recorded" />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Connection evidence unavailable",
    );
    expect(screen.queryByText("No evidence recorded")).not.toBeInTheDocument();
  });
  it("renders evidence and accepts with both versions before refreshing", async () => {
    const user = userEvent.setup();
    getConnections
      .mockResolvedValueOnce({ connections: [item] })
      .mockResolvedValueOnce({
        connections: [{ ...item, state: "user_accepted" }],
      });
    acceptConnection.mockResolvedValue({ status: "accepted" });
    render(<ConnectionEvidence noteId="s" />);
    await user.click(await screen.findByText(/outgoing/));
    expect(screen.getByText(/source excerpt/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Accept relation" }));
    await waitFor(() =>
      expect(acceptConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          source_id: "s",
          target_id: "t",
          source_modified: "s1",
          target_modified: "t1",
        }),
      ),
    );
    expect(getConnections).toHaveBeenCalledTimes(2);
  });
  it("keeps a suggested relation visible after a 409", async () => {
    const user = userEvent.setup();
    getConnections.mockResolvedValue({ connections: [item] });
    acceptConnection.mockRejectedValue(
      Object.assign(new Error("stale"), { status: 409 }),
    );
    render(<ConnectionEvidence noteId="s" />);
    await user.click(await screen.findByText(/outgoing/));
    await user.click(screen.getByRole("button", { name: "Accept relation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("stale");
    expect(
      screen.getByRole("button", { name: "Accept relation" }),
    ).toBeInTheDocument();
  });

  it("filters evidence to the selected graph relationship", async () => {
    getConnections.mockResolvedValue({
      connections: [
        item,
        {
          ...item,
          target_id: "other",
          rationale: "Unrelated relationship.",
        },
      ],
    });
    render(
      <ConnectionEvidence noteId="s" pair={{ sourceId: "s", targetId: "t" }} />,
    );

    expect(await screen.findByText(/outgoing/)).toBeInTheDocument();
    expect(
      screen.queryByText(/Unrelated relationship/),
    ).not.toBeInTheDocument();
  });

  it("can explain that the selected graph relationship has no recorded evidence", async () => {
    getConnections.mockResolvedValue({ connections: [] });
    render(
      <ConnectionEvidence
        noteId="s"
        pair={{ sourceId: "s", targetId: "t" }}
        emptyMessage="No recorded evidence for this relationship."
      />,
    );

    expect(
      await screen.findByText("No recorded evidence for this relationship."),
    ).toBeInTheDocument();
  });
});
