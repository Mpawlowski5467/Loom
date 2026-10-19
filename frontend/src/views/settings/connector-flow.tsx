import type { ReactNode } from "react";
import { Link2Off } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/views/settings/kit/SettingsCard";
import { SettingsGroup } from "@/views/settings/kit/SettingsGroup";
import { StatusLine } from "@/views/settings/kit/StatusLine";
import { AlertLine } from "./connections/AlertLine";
import { CollapsedCredentials } from "./connections/CollapsedCredentials";
import { CredentialsForm } from "./connections/CredentialsForm";
import { SetupChecklist } from "./connections/SetupChecklist";
import { SignInButton } from "./connections/SignInButton";
import { INLINE_LINK } from "./connections/styles";
import {
  useConnectorFlow,
  type ConnectorFlowOptions,
} from "./connections/useConnectorFlow";

/**
 * The guided connect flow shared by the OAuth connector cards (Google,
 * Microsoft). Three states, driven by whether credentials are saved and
 * whether a token exists:
 *
 *   setup     — no saved credentials: numbered checklist + credential form +
 *               a disabled sign-in button whose hint explains why.
 *   ready     — credentials saved, no token: credentials collapse to one
 *               muted line (Edit re-expands) and the sign-in button is the
 *               single dominant action.
 *   connected — token present: account line + Disconnect, then the per-
 *               service sections rendered as the shell's children.
 *
 * The shell owns all credential/sign-in state; each card only wires its API
 * calls and supplies service sections. Sign-in polling lives in
 * ``useConnectPoll.ts``.
 */

interface ConnectorFlowShellProps extends Omit<
  ConnectorFlowOptions,
  "builtinApp"
> {
  title: string;
  blurb: string;
  steps: ReactNode[];
  signInLabel: string;
  clientIdPlaceholder: string;
  account: string;
  /** Why the card's saved state could not be loaded. */
  loadError?: string | null;
  builtinApp?: boolean;
  children?: ReactNode;
}

export function ConnectorFlowShell({
  title,
  blurb,
  steps,
  signInLabel,
  clientIdPlaceholder,
  account,
  loadError,
  builtinApp = false,
  children,
  ...options
}: ConnectorFlowShellProps) {
  const flow = useConnectorFlow({ ...options, builtinApp });
  const { connected, savedClientId, clientSecretSet } = options;
  const { busy, oneClick, ownApp } = flow;

  return (
    <SettingsGroup level={2} title={title} description={blurb}>
      <SettingsCard>
        {!connected && oneClick && !ownApp && (
          <p className="text-sm">
            <Button
              type="button"
              variant="link"
              className={INLINE_LINK}
              onClick={() => flow.setOwnApp(true)}
            >
              Use your own OAuth app instead
            </Button>
          </p>
        )}

        {!flow.hasSavedCreds && (!oneClick || ownApp) && (
          <SetupChecklist steps={steps} />
        )}

        {oneClick && !ownApp ? null : flow.showForm ? (
          <CredentialsForm
            clientId={flow.clientId}
            clientSecret={flow.clientSecret}
            secretSaved={clientSecretSet}
            clientIdPlaceholder={clientIdPlaceholder}
            busy={busy !== null}
            onClientIdChange={flow.setClientId}
            onClientSecretChange={flow.setClientSecret}
            onSave={() => void flow.saveCreds()}
            onCancel={
              flow.hasSavedCreds || oneClick ? flow.cancelEdit : undefined
            }
          />
        ) : (
          <CollapsedCredentials
            clientId={savedClientId}
            onEdit={() => flow.setEditing(true)}
          />
        )}

        {!connected && (
          <SignInButton
            label={signInLabel}
            enabled={flow.signInEnabled}
            busy={busy === "connect"}
            hint={flow.signInHint}
            onClick={() => void flow.connect()}
          />
        )}

        {connected && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <StatusLine>
                Connected{account ? ` as ${account}` : ""}
              </StatusLine>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Disconnect ${title}`}
                onClick={() => void flow.disconnect()}
                disabled={busy !== null}
              >
                <Link2Off aria-hidden="true" />
                {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
              </Button>
            </div>
            {children}
          </>
        )}

        {flow.error && <AlertLine>{flow.error}</AlertLine>}
        {loadError && <AlertLine>{loadError}</AlertLine>}
      </SettingsCard>
    </SettingsGroup>
  );
}
