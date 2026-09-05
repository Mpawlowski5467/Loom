import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SourceCapture } from "./SourceCapture";
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../api/client", () => ({ apiClient: { get } }));

it("loads preserved source only when requested and includes the final source paragraph", async () => {
  get.mockResolvedValue({
    title: "Original",
    body: "Opening\n\nUNIQUE_FINAL_REQUIREMENT",
  });
  const { container } = render(<SourceCapture noteId="filed" />);
  expect(get).not.toHaveBeenCalled();
  const details = container.querySelector("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  expect(
    await screen.findByText("UNIQUE_FINAL_REQUIREMENT"),
  ).toBeInTheDocument();
  expect(get).toHaveBeenCalledWith("/api/sources/filed");
});
