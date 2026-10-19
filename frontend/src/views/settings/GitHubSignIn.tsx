import { ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  pollGitHubSignIn,
  startGitHubSignIn,
  type GitHubSignInStart,
} from "@/api/automations";
import { Button } from "@/components/ui/button";
import { StatusLine } from "@/views/settings/kit/StatusLine";
import { AlertLine } from "./connections/AlertLine";
import { CheckboxField } from "./connections/CheckboxField";
import { CopyChip } from "./connections/CopyChip";
import { describeApiError } from "@/api/client";

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
}: GitHubSignInProps) {
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
        setError(describeApiError(err, "GitHub sign-in failed"));
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
      setError(describeApiError(err, "Could not start GitHub sign-in"));
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
      setError(describeApiError(err, "Could not sign out"));
    } finally {
      setBusy(false);
    }
  };

  if (account) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <StatusLine>Signed in as @{account}</StatusLine>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void signOut()}
          disabled={busy || disabled}
        >
          {busy ? "Signing out…" : "Sign out"}
        </Button>
        {error && <AlertLine className="basis-full">{error}</AlertLine>}
      </div>
    );
  }

  if (pending) {
    const verifyUrl = pending.verification_uri.startsWith(GITHUB_ORIGIN)
      ? pending.verification_uri
      : "https://github.com/login/device";
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Enter this code on GitHub to connect Loom:
        </p>
        <p className="flex flex-wrap items-center gap-3">
          <code
            aria-label="GitHub sign-in code"
            className="font-mono text-2xl tracking-widest text-foreground"
          >
            {pending.user_code}
          </code>
          <CopyChip text={pending.user_code} />
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm">
            <a href={verifyUrl} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden="true" />
              Open GitHub
            </a>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPending(null)}
          >
            Cancel
          </Button>
        </div>
        <StatusLine>Waiting for you to approve on GitHub…</StatusLine>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        size="sm"
        className="self-start"
        onClick={() => void start()}
        disabled={busy || disabled}
      >
        {busy ? "Starting…" : "Sign in with GitHub"}
      </Button>
      <CheckboxField
        label="Include private repositories"
        hint="GitHub asks for full repository access for this; Loom only reads."
        checked={includePrivate}
        onCheckedChange={setIncludePrivate}
      />
      {error && <AlertLine>{error}</AlertLine>}
    </div>
  );
}
