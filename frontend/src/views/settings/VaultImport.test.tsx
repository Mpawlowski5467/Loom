import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VaultImport } from "./VaultImport";
import { ApiError } from "../../api/client";

const { importVault } = vi.hoisted(() => ({ importVault: vi.fn() }));
vi.mock("../../api/vault", () => ({ importVault }));

function mkFile(name = "demo-export-20260101T000000Z.tar.gz"): File {
  return new File(["fake-tarball-bytes"], name, { type: "application/gzip" });
}

beforeEach(() => {
  importVault.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("VaultImport", () => {
  it("derives the destination name from the chosen file", async () => {
    const user = userEvent.setup();
    render(<VaultImport onImported={vi.fn()} />);

    await user.upload(screen.getByLabelText(/choose file/i), mkFile());

    expect(screen.getByRole("textbox")).toHaveValue("demo");
    expect(screen.getByText(/Selected: demo-export/)).toBeInTheDocument();
  });

  it("imports the file and refreshes the list on success", async () => {
    const user = userEvent.setup();
    const onImported = vi.fn();
    importVault.mockResolvedValue({ name: "demo", path: "/v/demo", is_active: false });
    render(<VaultImport onImported={onImported} />);

    const file = mkFile();
    await user.upload(screen.getByLabelText(/choose file/i), file);
    await user.click(screen.getByRole("button", { name: "Import" }));

    expect(importVault).toHaveBeenCalledWith("demo", file, false);
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(screen.getByText(/Imported "demo"/)).toBeInTheDocument();
  });

  it("retries with overwrite after a 409 when the user confirms", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    importVault
      .mockRejectedValueOnce(new ApiError("exists", 409))
      .mockResolvedValueOnce({ name: "demo", path: "/v/demo", is_active: false });
    render(<VaultImport onImported={vi.fn()} />);

    const file = mkFile();
    await user.upload(screen.getByLabelText(/choose file/i), file);
    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() =>
      expect(importVault).toHaveBeenLastCalledWith("demo", file, true),
    );
    expect(screen.getByText(/replaced the existing vault/)).toBeInTheDocument();
  });

  it("does not overwrite when the user declines the 409 confirm", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    importVault.mockRejectedValueOnce(new ApiError("exists", 409));
    render(<VaultImport onImported={vi.fn()} />);

    await user.upload(screen.getByLabelText(/choose file/i), mkFile());
    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() =>
      expect(screen.getByText("Import cancelled.")).toBeInTheDocument(),
    );
    expect(importVault).toHaveBeenCalledTimes(1); // no overwrite retry
  });

  it("surfaces a non-conflict error without retrying", async () => {
    const user = userEvent.setup();
    importVault.mockRejectedValueOnce(new ApiError("Invalid tarball: bad gzip", 400));
    render(<VaultImport onImported={vi.fn()} />);

    await user.upload(screen.getByLabelText(/choose file/i), mkFile());
    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() =>
      expect(screen.getByText(/Invalid tarball/)).toBeInTheDocument(),
    );
    expect(importVault).toHaveBeenCalledTimes(1);
  });
});
