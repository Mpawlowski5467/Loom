import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConnectorFlowShell } from "./connector-flow";

function renderShell(
  overrides: Partial<Parameters<typeof ConnectorFlowShell>[0]> = {},
) {
  const onConnect = vi.fn().mockResolvedValue(undefined);
  render(
    <ConnectorFlowShell
      title="Google"
      headingId="google-title"
      blurb="One sign-in for Calendar and Gmail."
      steps={[<>Create a project in the Google Cloud console.</>]}
      signInLabel="Sign in with Google"
      clientIdPlaceholder="….apps.googleusercontent.com"
      savedClientId=""
      clientSecretSet={false}
      connected={false}
      account=""
      loaded
      onSaveCreds={vi.fn().mockResolvedValue(undefined)}
      onConnect={onConnect}
      onDisconnect={vi.fn().mockResolvedValue(undefined)}
      {...overrides}
    />,
  );
  return { onConnect };
}

describe("ConnectorFlowShell one-click mode", () => {
  it("signs in straight away with Loom's built-in app", async () => {
    const { onConnect } = renderShell({ builtinApp: true });

    expect(screen.queryByText(/Google Cloud console/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Client ID")).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Sign in with Google" }),
    );

    expect(onConnect).toHaveBeenCalled();
  });

  it("still lets the user bring their own app", async () => {
    renderShell({ builtinApp: true });

    await userEvent.click(
      screen.getByRole("button", { name: "Use your own OAuth app instead" }),
    );

    expect(screen.getByText(/Google Cloud console/)).toBeInTheDocument();
    expect(screen.getByLabelText("Client ID")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Client ID"), "mine");
    // An unsaved draft must not be ignored by signing in with Loom's app.
    expect(
      screen.getByRole("button", { name: "Sign in with Google" }),
    ).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Client ID")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign in with Google" }),
    ).toBeEnabled();
  });

  it("keeps the setup flow when no built-in app is available", () => {
    renderShell({ builtinApp: false });

    expect(screen.getByText(/Google Cloud console/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign in with Google" }),
    ).toBeDisabled();
  });
});
