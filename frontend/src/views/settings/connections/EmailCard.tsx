import { Link2Off, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/views/settings/kit/SettingsCard";
import { SettingsGroup } from "@/views/settings/kit/SettingsGroup";
import { StatusLine } from "@/views/settings/kit/StatusLine";
import { AlertLine } from "./AlertLine";
import { EmailFields } from "./EmailFields";
import { EnableSwitch } from "./EnableSwitch";
import { PollStatus } from "./PollStatus";
import { ACTION_ROW } from "./styles";
import { useEmailBridge } from "./useEmailBridge";

/** The IMAP email bridge: polls a mailbox, read-only. */
export function EmailCard() {
  const bridge = useEmailBridge();
  const { email, busy, ready, testResult } = bridge;

  return (
    <SettingsGroup
      title="Email bridge"
      description="Poll an IMAP mailbox for new mail — messages land in the Inbox for triage. Read-only: Loom never marks mail as seen."
      actions={
        <EnableSwitch
          label="Enable email connection"
          checked={bridge.enabled}
          onCheckedChange={bridge.setEnabled}
          disabled={!email || busy !== null || (!bridge.enabled && !ready)}
        />
      }
    >
      <SettingsCard>
        <EmailFields bridge={bridge} />

        <div className={ACTION_ROW}>
          <Button
            type="button"
            size="sm"
            aria-label="Save email settings"
            onClick={() => void bridge.save()}
            disabled={!email || busy !== null}
          >
            {busy === "save" ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Test email connection"
            onClick={() => void bridge.test()}
            disabled={!email || busy !== null || !ready}
          >
            {busy === "test" ? "Testing…" : "Test connection"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Sync email now"
            onClick={() => void bridge.sync()}
            disabled={!email || busy !== null || !ready}
          >
            <RefreshCw aria-hidden="true" />
            {busy === "sync" ? "Syncing…" : "Sync now"}
          </Button>
          {bridge.passwordSaved && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Disconnect email"
              onClick={() => void bridge.disconnect()}
              disabled={busy !== null}
            >
              <Link2Off aria-hidden="true" /> Disconnect
            </Button>
          )}
        </div>

        {bridge.error && <AlertLine>{bridge.error}</AlertLine>}
        {testResult && (
          <StatusLine tone={testResult.ok ? "ok" : "error"}>
            {testResult.ok
              ? `Connected — ${testResult.folder} has ${testResult.messages} message${testResult.messages === 1 ? "" : "s"}`
              : testResult.error}
          </StatusLine>
        )}
        <PollStatus status={email?.status} />
      </SettingsCard>
    </SettingsGroup>
  );
}
