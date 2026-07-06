import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getHardware, saveHardware } from "../../api/hardware";
import type { HardwareProfile } from "../../api/types";
import { HardwareScanCard } from "./HardwareScanCard";

vi.mock("../../api/hardware", () => ({
  getHardware: vi.fn(),
  saveHardware: vi.fn(),
}));

const mockedGet = vi.mocked(getHardware);
const mockedSave = vi.mocked(saveHardware);

function mkProfile(overrides: Partial<HardwareProfile> = {}): HardwareProfile {
  return {
    scanned_at: "2026-07-05T10:00:00+00:00",
    os: "macOS 15.5 arm64",
    cpu_model: "Apple M3",
    cpu_cores: 8,
    ram_gb: 16,
    gpu_name: "Apple GPU",
    vram_gb: null,
    unified_memory: true,
    notes: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("HardwareScanCard", () => {
  it("disables Save profile until a scan has run", () => {
    render(<HardwareScanCard />);
    expect(
      screen.getByRole("button", { name: /save profile/i }),
    ).toBeDisabled();
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("scans on demand and renders the machine specs", async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValue({ profile: mkProfile(), saved: null });
    render(<HardwareScanCard />);

    await user.click(screen.getByRole("button", { name: /scan hardware/i }));

    expect(screen.getByText("Apple M3")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("16 GB")).toBeInTheDocument();
    expect(screen.getByText("Apple GPU")).toBeInTheDocument();
    expect(screen.getByText(/unified memory/i)).toBeInTheDocument();
  });

  it("appends VRAM to the GPU line and skips the unified note on discrete GPUs", async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValue({
      profile: mkProfile({
        gpu_name: "RTX 4090",
        vram_gb: 24,
        unified_memory: false,
      }),
      saved: null,
    });
    render(<HardwareScanCard />);

    await user.click(screen.getByRole("button", { name: /scan hardware/i }));

    expect(screen.getByText("RTX 4090 · 24 GB VRAM")).toBeInTheDocument();
    expect(screen.queryByText(/unified memory/i)).not.toBeInTheDocument();
  });

  it("saves the scanned profile and shows the saved state", async () => {
    const user = userEvent.setup();
    const profile = mkProfile();
    mockedGet.mockResolvedValue({ profile, saved: null });
    mockedSave.mockResolvedValue({ saved: profile });
    render(<HardwareScanCard />);

    await user.click(screen.getByRole("button", { name: /scan hardware/i }));
    await user.click(screen.getByRole("button", { name: /save profile/i }));

    expect(mockedSave).toHaveBeenCalledWith(profile);
    expect(screen.getByText("Profile saved.")).toBeInTheDocument();
    expect(screen.getByText(/saved profile from/i)).toBeInTheDocument();
  });

  it("shows the previously saved profile state after a scan", async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValue({
      profile: mkProfile(),
      saved: mkProfile({ scanned_at: "2026-07-01T09:00:00+00:00" }),
    });
    render(<HardwareScanCard />);

    await user.click(screen.getByRole("button", { name: /scan hardware/i }));

    expect(screen.getByText(/saved profile from/i)).toBeInTheDocument();
  });

  it("surfaces a scan failure inline", async () => {
    const user = userEvent.setup();
    mockedGet.mockRejectedValue(new Error("backend down"));
    render(<HardwareScanCard />);

    await user.click(screen.getByRole("button", { name: /scan hardware/i }));

    expect(screen.getByText("backend down")).toBeInTheDocument();
  });
});
