import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { CalendarDays } from "lucide-react";
import type {
  OAuthCalendarConnectResult,
  OAuthCalendarConnection,
  OAuthCalendarStatus,
  OAuthCalendarSyncResult,
  OAuthCalendarTestResult,
  OAuthCalendarUpdate,
} from "../../api/automations";
import { useApp } from "../../context/app-ctx";
import {
  ConnectorFlowShell,
  ServiceSection,
  type ServiceSectionValues,
} from "./connector-flow";
import { useConnectPoll } from "./useConnectPoll";

/**
 * Settings card for the OAuth calendar bridge (currently Outlook Calendar).
 *
 * The guided connect flow (checklist → credentials → sign-in) lives in
 * ConnectorFlowShell; this card wires the provider's API bundle and renders
 * its single Calendar service section once connected. The card never sees
 * the stored secret or any token — only the redacted flags.
 */

export interface OAuthCardConfig {
  enabled: boolean;
  client_id: string;
  client_secret_set: boolean;
  interval_minutes: number;
  lookback_days: number;
  calendar_ids?: string[];
}

export interface OAuthCalendarState {
  config: OAuthCardConfig;
  connection: OAuthCalendarConnection;
  status: OAuthCalendarStatus;
}

export interface OAuthCalendarCardApi {
  get(signal?: AbortSignal): Promise<OAuthCalendarState>;
  update(update: OAuthCalendarUpdate): Promise<OAuthCalendarState>;
  connect(): Promise<OAuthCalendarConnectResult>;
  disconnect(): Promise<OAuthCalendarState>;
  test(signal?: AbortSignal): Promise<OAuthCalendarTestResult>;
  sync(signal?: AbortSignal): Promise<OAuthCalendarSyncResult>;
}

interface OAuthCalendarCardProps {
  provider: string;
  title: string;
  headingId: string;
  blurb: string;
  steps: ReactNode[];
  signInLabel: string;
  clientIdPlaceholder: string;
  calendarIdsPlaceholder: string;
  api: OAuthCalendarCardApi;
}

export function OAuthCalendarCard({
  provider,
  title,
  headingId,
  blurb,
  steps,
  signInLabel,
  clientIdPlaceholder,
  calendarIdsPlaceholder,
  api,
}: OAuthCalendarCardProps): ReactNode {
  const { pushToast } = useApp();
  const [automation, setAutomation] = useState<OAuthCalendarState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const apply = useCallback((next: OAuthCalendarState) => {
    setAutomation(next);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api
      .get(controller.signal)
      .then(apply)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(
          err instanceof Error ? err.message : `${title} could not be loaded`,
        );
      });
    return () => controller.abort();
  }, [api, apply, title]);

  const { startPolling } = useConnectPoll({
    reload: () => api.get(),
    apply,
    isConnected: (next) => next.connection.connected,
    account: (next) => next.connection.account,
    toastLabel: title,
  });

  const saveCreds = async (clientId: string, clientSecret: string) => {
    const next = await api.update({
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
    });
    apply(next);
    pushToast({
      icon: "✓",
      agent: provider,
      body: `${title} credentials saved`,
    });
  };

  const connect = async () => {
    const result = await api.connect();
    window.open(result.authorization_url, "_blank", "noopener");
    // The OAuth callback lands in the other tab; poll until it lands.
    startPolling();
  };

  const disconnect = async () => {
    const next = await api.disconnect();
    apply(next);
  };

  const saveService = async (values: ServiceSectionValues): Promise<void> => {
    const next = await api.update({
      enabled: values.enabled,
      interval_minutes: values.intervalMinutes,
      lookback_days: values.lookbackDays,
      calendar_ids: values.calendarIds,
    });
    apply(next);
  };

  const testService = async () => api.test();

  const syncService = async () => {
    const result = await api.sync();
    return {
      created: result.created,
      deduplicated: result.deduplicated,
      failed: result.errors,
      errorLines: result.calendars
        .filter((calendar) => calendar.error)
        .map((calendar) => `${calendar.calendar}: ${calendar.error}`),
    };
  };

  const connected = automation?.connection.connected ?? false;

  return (
    <section
      className="settings-connection-card"
      aria-labelledby={headingId}
    >
      <ConnectorFlowShell
        title={title}
        headingId={headingId}
        icon={<CalendarDays size={17} aria-hidden="true" />}
        blurb={blurb}
        steps={steps}
        signInLabel={signInLabel}
        clientIdPlaceholder={clientIdPlaceholder}
        savedClientId={automation?.config.client_id ?? ""}
        clientSecretSet={automation?.config.client_secret_set ?? false}
        connected={connected}
        account={automation?.connection.account ?? ""}
        loaded={automation !== null}
        onSaveCreds={saveCreds}
        onConnect={connect}
        onDisconnect={disconnect}
      >
        {automation && (
          <ServiceSection
            title="Calendar"
            blurb="Events from your calendars become Inbox captures."
            headingId={`${provider}-calendar-service-title`}
            serviceLabel={title}
            savedEnabled={automation.config.enabled}
            savedIntervalMinutes={automation.config.interval_minutes}
            savedLookbackDays={automation.config.lookback_days}
            savedCalendarIdsText={automation.config.calendar_ids?.join("\n") ?? ""}
            status={automation.status}
            calendarIdsPlaceholder={calendarIdsPlaceholder}
            disabled={false}
            onSave={saveService}
            onTest={testService}
            onSync={syncService}
          />
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
