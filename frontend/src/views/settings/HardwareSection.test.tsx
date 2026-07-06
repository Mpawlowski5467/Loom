import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HardwareSection } from "./HardwareSection";

// Each card is its own API-driven unit with colocated tests; stub them so the
// composer's job — panel chrome + ordering — is what's under test.
vi.mock("./HardwareScanCard", () => ({
  HardwareScanCard: () => <div data-testid="card-scan" />,
}));
vi.mock("./ModelAdvisorCard", () => ({
  ModelAdvisorCard: () => <div data-testid="card-advisor" />,
}));
vi.mock("./AgentModelsCard", () => ({
  AgentModelsCard: () => <div data-testid="card-agents" />,
}));

describe("HardwareSection", () => {
  it("renders the panel chrome and all three cards", () => {
    render(<HardwareSection />);
    expect(
      screen.getByRole("heading", { name: "Hardware & Models" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("card-scan")).toBeInTheDocument();
    expect(screen.getByTestId("card-advisor")).toBeInTheDocument();
    expect(screen.getByTestId("card-agents")).toBeInTheDocument();
  });
});
