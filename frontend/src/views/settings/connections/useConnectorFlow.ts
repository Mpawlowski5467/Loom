import { useState } from "react";
import { describeApiError } from "@/api/client";

export interface ConnectorFlowOptions {
  savedClientId: string;
  clientSecretSet: boolean;
  connected: boolean;
  loaded: boolean;
  /** Loom ships its own app: sign in directly, own app is optional. */
  builtinApp: boolean;
  onSaveCreds: (clientId: string, clientSecret: string) => Promise<void>;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
}

/** Credential drafts, flow state (setup / ready / connected) and actions. */
export function useConnectorFlow({
  savedClientId,
  clientSecretSet,
  connected,
  loaded,
  builtinApp,
  onSaveCreds,
  onConnect,
  onDisconnect,
}: ConnectorFlowOptions) {
  const [clientId, setClientId] = useState(savedClientId);
  const [clientSecret, setClientSecret] = useState("");
  const [editing, setEditing] = useState(false);
  const [ownApp, setOwnApp] = useState(false);
  const [busy, setBusy] = useState<"save" | "connect" | "disconnect" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  // Adopt freshly-saved credentials (initial load, save, disconnect) without
  // clobbering an in-flight edit: only re-sync when the saved value changes.
  const [syncedClientId, setSyncedClientId] = useState(savedClientId);
  if (syncedClientId !== savedClientId) {
    setSyncedClientId(savedClientId);
    setClientId(savedClientId);
  }

  const hasSavedCreds = savedClientId.trim() !== "" && clientSecretSet;
  const credsDirty =
    clientSecret.trim() !== "" || clientId.trim() !== savedClientId.trim();
  // One-click: Loom's built-in app signs in, so no setup is needed unless
  // the user opts to bring their own app (which then wins, as saved creds).
  const oneClick = builtinApp && !hasSavedCreds;
  // setup: no saved creds (form always). ready: saved + collapsed. Edit
  // re-opens the form; connect stays disabled while drafts diverge.
  const showForm = oneClick ? ownApp : !hasSavedCreds || editing;
  const canSignIn = oneClick
    ? !(ownApp && credsDirty)
    : hasSavedCreds && !credsDirty;
  const signInEnabled = loaded && !connected && canSignIn && busy === null;
  const signInHint =
    !oneClick && !hasSavedCreds
      ? "Save your client ID and secret above first."
      : credsDirty
        ? "Save your changes first."
        : undefined;

  const run = async (
    action: "save" | "connect" | "disconnect",
    work: () => Promise<void>,
    fallback: string,
  ) => {
    setBusy(action);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(describeApiError(err, fallback));
    } finally {
      setBusy(null);
    }
  };

  const saveCreds = () =>
    run(
      "save",
      async () => {
        await onSaveCreds(clientId.trim(), clientSecret.trim());
        setClientSecret("");
        setEditing(false);
      },
      "Could not save credentials",
    );

  const cancelEdit = () => {
    setClientId(savedClientId);
    setClientSecret("");
    setEditing(false);
    setOwnApp(false);
    setError(null);
  };

  const connect = () =>
    run("connect", onConnect, "Could not start the sign-in");

  const disconnect = () =>
    run(
      "disconnect",
      async () => {
        await onDisconnect();
        setClientSecret("");
      },
      "Could not disconnect",
    );

  return {
    clientId,
    setClientId,
    clientSecret,
    setClientSecret,
    setEditing,
    ownApp,
    setOwnApp,
    busy,
    error,
    hasSavedCreds,
    oneClick,
    showForm,
    signInEnabled,
    signInHint,
    saveCreds,
    cancelEdit,
    connect,
    disconnect,
  };
}
