import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  pollGitHubSignIn,
  startGitHubSignIn,
  type GitHubSignInStart,
} from "../../api/automations";
import { GitHubSignIn } from "./GitHubSignIn";

vi.mock("../../api/automations", () => ({
  startGitHubSignIn: vi.fn(),
  pollGitHubSignIn: vi.fn(),
}));

// interval 0 keeps the poll loop on real timers without slowing the test.
const flow: GitHubSignInStart = {
  flow_id: "flow-1",
  user_code: "WDJB-MJHT",
  verification_uri: "https://github.com/login/device",
  expires_in: 900,
  interval: 0,
};

function renderSignIn(account = "") {
  const onConnected = vi.fn();
  const onSignOut = vi.fn().mockResolvedValue(undefined);
  render(
    <GitHubSignIn
      account={account}
      onConnected={onConnected}
      onSignOut={onSignOut}
    />,
  );
  return { onConnected, onSignOut };
}

describe("GitHubSignIn", () => {
  beforeEach(() => {
    vi.mocked(startGitHubSignIn).mockReset().mockResolvedValue(flow);
    vi.mocked(pollGitHubSignIn).mockReset();
  });

  it("shows the code to enter on GitHub, then reports the signed-in account", async () => {
    vi.mocked(pollGitHubSignIn)
      .mockResolvedValueOnce({ status: "pending", interval: 0, account: "" })
      .mockResolvedValueOnce({
        status: "connected",
        interval: 0,
        account: "ada-dev",
      });
    const { onConnected } = renderSignIn();

    await userEvent.click(
      screen.getByRole("button", { name: "Sign in with GitHub" }),
    );

    expect(
      await screen.findByLabelText("GitHub sign-in code"),
    ).toHaveTextContent("WDJB-MJHT");
    expect(screen.getByRole("link", { name: /Open GitHub/ })).toHaveAttribute(
      "href",
      "https://github.com/login/device",
    );
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("ada-dev"));
    expect(startGitHubSignIn).toHaveBeenCalledWith(false);
    expect(pollGitHubSignIn).toHaveBeenCalledWith("flow-1", expect.anything());
  });

  it("asks for private repositories only when opted in", async () => {
    vi.mocked(pollGitHubSignIn).mockReturnValue(new Promise(() => {}));
    renderSignIn();

    await userEvent.click(
      screen.getByRole("checkbox", { name: /Include private repositories/ }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Sign in with GitHub" }),
    );

    expect(startGitHubSignIn).toHaveBeenCalledWith(true);
  });

  it("explains a sign-in cancelled on GitHub", async () => {
    vi.mocked(pollGitHubSignIn).mockResolvedValue({
      status: "denied",
      interval: 0,
      account: "",
    });
    const { onConnected } = renderSignIn();

    await userEvent.click(
      screen.getByRole("button", { name: "Sign in with GitHub" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/cancelled/);
    expect(onConnected).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Sign in with GitHub" }),
    ).toBeInTheDocument();
  });

  it("shows the account and signs out", async () => {
    const { onSignOut } = renderSignIn("ada-dev");

    expect(screen.getByRole("status")).toHaveTextContent(
      "Signed in as @ada-dev",
    );
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(onSignOut).toHaveBeenCalled();
  });

  it("stops polling when unmounted", async () => {
    vi.mocked(pollGitHubSignIn).mockResolvedValue({
      status: "pending",
      interval: 0,
      account: "",
    });
    const { unmount } = render(
      <GitHubSignIn account="" onConnected={vi.fn()} onSignOut={vi.fn()} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Sign in with GitHub" }),
    );
    await waitFor(() => expect(pollGitHubSignIn).toHaveBeenCalled());

    unmount();
    const calls = vi.mocked(pollGitHubSignIn).mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(vi.mocked(pollGitHubSignIn).mock.calls.length).toBe(calls);
  });
});
