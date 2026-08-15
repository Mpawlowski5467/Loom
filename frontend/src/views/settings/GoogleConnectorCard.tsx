import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link2 } from "lucide-react";
import {
  connectGoogle,
  disconnectGoogle,
  getGoogleConnector,
  syncGmail,
  syncGoogleCalendar,
  testGoogle,
  updateGoogleConnector,
  type GoogleConnectorAutomation,
} from "../../api/automations";
import { apiUrl } from "../../api/client";
import { useApp } from "../../context/app-ctx";
import {
  ConnectorFlowShell,
  CopyChip,
  ServiceSection,
  type ServiceSectionValues,
} from "./connector-flow";
import { useConnectPoll } from "./useConnectPoll";

/**
 * Google connector card: ONE OAuth client + ONE sign-in whose consent covers
 * both services (Calendar + Gmail). The guided flow (checklist → credentials
 * → sign-in) lives in ConnectorFlowShell; after connecting, each service is
 * just a toggle plus poll settings — enabling one later never needs
 * re-consent. The card never sees the stored secret or the token, only the
 * redacted flags.
 */

const GOOGLE_STEPS: ReactNode[] = [
  <>
    Create a project in the{" "}
    <a
      href="https://console.cloud.google.com/apis/library"
      target="_blank"
      rel="noreferrer"
    >
      Google Cloud console
    </a>{" "}
    and enable the <strong>Google Calendar API</strong> and{" "}
    <strong>Gmail API</strong>.
  </>,
  <>
    On the{" "}
    <a
      href="https://console.cloud.google.com/apis/credentials/consent"
      target="_blank"
      rel="noreferrer"
    >
      OAuth consent screen
    </a>
    , add the scopes <code>calendar.readonly</code> and{" "}
    <code>gmail.readonly</code>.
  </>,
  <>
    Create an{" "}
    <a
      href="https://console.cloud.google.com/apis/credentials"
      target="_blank"
      rel="noreferrer"
    >
      OAuth client ID
    </a>{" "}
    (Web application) with this redirect URI:{" "}
    <CopyChip text={apiUrl("/api/automations/google/callback")} />
  </>,
  <>
    Paste the client ID and secret below and Save — one consent covers both
    services.
  </>,
];

export function GoogleConnectorCard(): ReactNode {
  const { pushToast } = useApp();
  const [automation, setAutomation] =
    useState<GoogleConnectorAutomation | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const apply = useCallback((next: GoogleConnectorAutomation) => {
    setAutomation(next);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getGoogleConnector(controller.signal)
      .then(apply)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(
          err instanceof Error
            ? err.message
            : "Google connection could not be loaded",
        );
      });
    return () => controller.abort();
  }, [apply]);

  const { startPolling } = useConnectPoll({
    reload: () => getGoogleConnector(),
    apply,
    isConnected: (next) => next.connection.connected,
    account: (next) => next.connection.account,
    toastLabel: "Google",
  });

  const saveCreds = async (clientId: string, clientSecret: string) => {
    const next = await updateGoogleConnector({
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
    });
    apply(next);
    pushToast({ icon: "✓", agent: "google", body: "Google credentials saved" });
  };

  const connect = async () => {
    const result = await connectGoogle();
    window.open(result.authorization_url, "_blank", "noopener");
    // The OAuth callback lands in the other tab; poll until it lands.
    startPolling();
  };

  const disconnect = async () => {
    const next = await disconnectGoogle();
    apply(next);
  };

  const saveService =
    (service: "calendar" | "gmail") =>
    async (values: ServiceSectionValues): Promise<void> => {
      const shared = {
        enabled: values.enabled,
        interval_minutes: values.intervalMinutes,
        lookback_days: values.lookbackDays,
      };
      const next = await updateGoogleConnector(
        service === "calendar"
          ? { calendar: { ...shared, calendar_ids: values.calendarIds } }
          : { gmail: shared },
      );
      apply(next);
    };

  const testService = (service: "calendar" | "gmail") => async () => {
    const result = await testGoogle();
    return service === "calendar" ? result.calendar : result.gmail;
  };

  const syncCalendar = async () => {
    const result = await syncGoogleCalendar();
    return {
      created: result.created,
      deduplicated: result.deduplicated,
      failed: result.errors,
      errorLines: result.calendars
        .filter((calendar) => calendar.error)
        .map((calendar) => `${calendar.calendar}: ${calendar.error}`),
    };
  };

  const syncMailbox = async () => {
    const result = await syncGmail();
    return {
      created: result.created,
      deduplicated: result.deduplicated,
      failed: result.errors,
      errorLines:
        result.errors > 0
          ? [
              `${result.errors} message${result.errors === 1 ? "" : "s"} failed to fetch — retried on the next poll`,
            ]
          : [],
    };
  };

  const connected = automation?.connection.connected ?? false;

  return (
    <section
      className="settings-connection-card"
      aria-labelledby="google-connector-title"
    >
      <ConnectorFlowShell
        title="Google"
        headingId="google-connector-title"
        icon={<Link2 size={17} aria-hidden="true" />}
        blurb="One sign-in for Google Calendar and Gmail — events and mail land in the Inbox for triage. Read-only scopes; an OAuth alternative to the IMAP Email bridge below."
        steps={GOOGLE_STEPS}
        signInLabel="Sign in with Google"
        clientIdPlaceholder="….apps.googleusercontent.com"
        savedClientId={automation?.google.client_id ?? ""}
        clientSecretSet={automation?.google.client_secret_set ?? false}
        connected={connected}
        account={automation?.connection.account ?? ""}
        loaded={automation !== null}
        managedOAuth={automation?.managed_oauth ?? false}
        onSaveCreds={saveCreds}
        onConnect={connect}
        onDisconnect={disconnect}
      >
        {automation && (
          <>
            <ServiceSection
              title="Calendar"
              blurb="Events from your Google calendars become Inbox captures."
              headingId="google-calendar-service-title"
              serviceLabel="Google Calendar"
              savedEnabled={automation.google.calendar.enabled}
              savedIntervalMinutes={automation.google.calendar.interval_minutes}
              savedLookbackDays={automation.google.calendar.lookback_days}
              savedCalendarIdsText={automation.google.calendar.calendar_ids.join(
                "\n",
              )}
              status={automation.services.calendar}
              calendarIdsPlaceholder={"primary\nteam@group.calendar.google.com"}
              disabled={false}
              onSave={saveService("calendar")}
              onTest={testService("calendar")}
              onSync={syncCalendar}
            />
            <ServiceSection
              title="Gmail"
              blurb="New mail becomes Inbox captures. Read-only: Loom never marks mail as seen."
              headingId="gmail-service-title"
              serviceLabel="Gmail"
              savedEnabled={automation.google.gmail.enabled}
              savedIntervalMinutes={automation.google.gmail.interval_minutes}
              savedLookbackDays={automation.google.gmail.lookback_days}
              savedCalendarIdsText=""
              status={automation.services.gmail}
              disabled={false}
              onSave={saveService("gmail")}
              onTest={testService("gmail")}
              onSync={syncMailbox}
            />
          </>
        )}
      </ConnectorFlowShell>
      {loadError && (
        <p className="settings-test-result fail" role="alert">
          {loadError}
        </p>
      )}
    </section>
  );
}
