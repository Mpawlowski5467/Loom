import { ExternalLink } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  pollGitHubSignIn,
  startGitHubSignIn,
  type GitHubSignInStart,
} from "../../api/automations";
import { CopyChip } from "./connector-flow";

/**
 * "Sign in with GitHub" using the device flow (like `gh auth login`): Loom
 * shows a short code, the user approves it on github.com, and this component
 * polls on GitHub's interval until the token is saved server-side. The
 * browser never sees the token or the device code, only an opaque flow id.
 */

const GITHUB_ORIGIN = "https://github.com/";

interface GitHubSignInProps {
  /** Login of the signed-in account ("" when not signed in). */
  account: string;
  onConnected: (account: string) => void;
  onSignOut: () => Promise<void>;
  disabled?: boolean;
}

export function GitHubSignIn({
  account,
  onConnected,
  onSignOut,
  disabled = false,
}: GitHubSignInProps): ReactNode {
  const [includePrivate, setIncludePrivate] = useState(false);
  const [pending, setPending] = useState<GitHubSignInStart | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onConnectedRef = useRef(onConnected);

  useEffect(() => {
    onConnectedRef.current = onConnected;
  }, [onConnected]);

  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    let interval = pending.interval;
    let timer = 0;
    const tick = async () => {
      try {
        const result = await pollGitHubSignIn(
          pending.flow_id,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (result.status === "pending") {
          interval = result.interval || interval;
          timer = window.setTimeout(() => void tick(), interval * 1000);
          return;
        }
        setPending(null);
        if (result.status === "connected") {
          onConnectedRef.current(result.account);
        } else {
          setError(
            result.status === "denied"
              ? "Sign-in was cancelled on GitHub."
              : "The code expired before it was approved. Start again.",
          );
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setPending(null);
        setError(err instanceof Error ? err.message : "GitHub sign-in failed");
      }
    };
    timer = window.setTimeout(() => void tick(), interval * 1000);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [pending]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setPending(await startGitHubSignIn(includePrivate));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not start GitHub sign-in",
      );
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSignOut();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign out");
    } finally {
      setBusy(false);
    }
  };

  if (account) {
    return (
      <div className="settings-actions connector-signin">
        <p className="settings-connection-status" role="status">
          Signed in as @{account}
        </p>
        <button
          className="btn btn-md"
          type="button"
          onClick={() => void signOut()}
          disabled={busy || disabled}
        >
          {busy ? "Signing out…" : "Sign out"}
        </button>
        {error && (
          <p className="settings-test-result fail" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (pending) {
    const verifyUrl = pending.verification_uri.startsWith(GITHUB_ORIGIN)
      ? pending.verification_uri
      : "https://github.com/login/device";
    return (
      <div className="github-device">
        <p className="settings-connection-status">
          Enter this code on GitHub to connect Loom:
        </p>
        <p className="github-device-code">
          <code aria-label="GitHub sign-in code">{pending.user_code}</code>
          <CopyChip text={pending.user_code} />
        </p>
        <div className="settings-actions">
          <a
            className="btn btn-md btn-active"
            href={verifyUrl}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={13} aria-hidden="true" />
            Open GitHub
          </a>
          <button
            className="btn btn-md"
            type="button"
            onClick={() => setPending(null)}
          >
            Cancel
          </button>
        </div>
        <p className="settings-connection-status" role="status">
          Waiting for you to approve on GitHub…
        </p>
      </div>
    );
  }

  return (
    <div className="github-device">
      <div className="settings-actions connector-signin">
        <button
          className="btn btn-md btn-active"
          type="button"
          onClick={() => void start()}
          disabled={busy || disabled}
        >
          {busy ? "Starting…" : "Sign in with GitHub"}
        </button>
      </div>
      <label className="settings-toggle-row">
        <input
          type="checkbox"
          checked={includePrivate}
          onChange={(event) => setIncludePrivate(event.target.checked)}
        />
        <span>
          <span className="settings-toggle-label">
            Include private repositories
          </span>
          <span className="settings-toggle-hint">
            GitHub asks for full repository access for this; Loom only reads.
          </span>
        </span>
      </label>
      {error && (
        <p className="settings-test-result fail" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
