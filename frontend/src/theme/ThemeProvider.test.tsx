import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appearanceEndpointUnsupported,
  getAppearance,
  putAppearance,
} from "@/api/appearance";
import { stubPrefersDark } from "@/test/matchMedia";
import { normalizeAppearance } from "./appearance";
import { useAppearance } from "./appearance-ctx";
import { APPEARANCE_STORAGE_KEY } from "./appearanceStorage";
import { ThemeProvider } from "./ThemeProvider";

vi.mock("@/api/appearance", () => ({
  getAppearance: vi.fn(),
  putAppearance: vi.fn(),
  appearanceEndpointUnsupported: vi.fn(),
}));

const getMock = vi.mocked(getAppearance);
const putMock = vi.mocked(putAppearance);
const unsupportedMock = vi.mocked(appearanceEndpointUnsupported);

function Probe() {
  const { resolvedTheme, savedTo, setTheme, toggleMode, update } =
    useAppearance();
  return (
    <div>
      <output aria-label="theme">{resolvedTheme}</output>
      <output aria-label="saved">{savedTo}</output>
      <button onClick={() => setTheme("forest")}>forest</button>
      <button onClick={toggleMode}>toggle</button>
      <button onClick={() => update({ followSystem: true })}>follow</button>
      <button onClick={() => update({ brandOverride: "#f59e0b" })}>
        amber
      </button>
    </div>
  );
}

const html = () => document.documentElement;

function store(settings: object) {
  localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(settings));
}

function stored() {
  return JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? "null");
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    getMock.mockResolvedValue(null);
    putMock.mockResolvedValue(true);
    unsupportedMock.mockReturnValue(false);
    stubPrefersDark(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("paints the stored settings onto <html>", async () => {
    store({ theme: "linen", editorFont: "serif", graphPalette: "colorblind" });
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(html()).toHaveAttribute("data-theme", "linen");
    expect(html()).toHaveAttribute("data-theme-mode", "light");
    expect(html()).toHaveAttribute("data-editor-font", "serif");
    expect(html()).toHaveAttribute("data-graph-palette", "colorblind");
    await waitFor(() => expect(getMock).toHaveBeenCalled());
  });

  it("migrates the old theme keys on first run", () => {
    localStorage.setItem("loom.theme", "lagoon");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(html()).toHaveAttribute("data-theme", "forest");
    expect(stored()).toMatchObject({ theme: "forest" });
    expect(localStorage.getItem("loom.theme")).toBeNull();
  });

  it("picking a theme applies, caches and saves it to the vault", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole("button", { name: "forest" }));

    expect(html()).toHaveAttribute("data-theme", "forest");
    expect(stored()).toMatchObject({ theme: "forest", darkTheme: "forest" });
    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith(
        expect.objectContaining({ theme: "forest" }),
      ),
    );
  });

  it("the quick toggle flips between the dark and light themes", async () => {
    const user = userEvent.setup();
    store({ theme: "midnight", lightTheme: "linen" });
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole("button", { name: "toggle" }));
    expect(html()).toHaveAttribute("data-theme", "linen");
    await user.click(screen.getByRole("button", { name: "toggle" }));
    expect(html()).toHaveAttribute("data-theme", "midnight");
  });

  it("follows the OS preference while followSystem is on", async () => {
    const user = userEvent.setup();
    const os = stubPrefersDark(false);
    store({ theme: "graphite", lightTheme: "linen", darkTheme: "midnight" });
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole("button", { name: "follow" }));
    expect(html()).toHaveAttribute("data-theme", "linen");

    act(() => os.flip(true));
    expect(html()).toHaveAttribute("data-theme", "midnight");
    expect(screen.getByLabelText("theme")).toHaveTextContent("midnight");
  });

  it("sets the accent override attribute", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole("button", { name: "amber" }));
    expect(html()).toHaveAttribute("data-brand", "amber");
  });

  it("the vault's saved settings win on load", async () => {
    store({ theme: "paper" });
    getMock.mockResolvedValue(normalizeAppearance({ theme: "forest" }));
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => expect(html()).toHaveAttribute("data-theme", "forest"));
    expect(screen.getByLabelText("saved")).toHaveTextContent("vault");
    expect(stored()).toMatchObject({ theme: "forest" });
  });

  it("a vault with nothing saved adopts this device's settings", async () => {
    store({ theme: "linen" });
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith(
        expect.objectContaining({ theme: "linen" }),
      ),
    );
  });

  it("keeps settings on this device when the endpoint is missing", async () => {
    unsupportedMock.mockReturnValue(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(screen.getByLabelText("saved")).toHaveTextContent("device");
    expect(putMock).not.toHaveBeenCalled();
  });

  it("?theme= pins the theme over storage and the vault", async () => {
    window.history.replaceState(null, "", "/?theme=midnight");
    store({ theme: "paper" });
    getMock.mockResolvedValue(normalizeAppearance({ theme: "forest" }));
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(html()).toHaveAttribute("data-theme", "midnight");
    expect(stored()).toMatchObject({ theme: "paper" });
  });
});
