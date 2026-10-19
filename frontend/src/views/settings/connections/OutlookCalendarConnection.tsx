import type { ReactNode } from "react";
import {
  connectOutlookCalendar,
  disconnectOutlookCalendar,
  getOutlookCalendarAutomation,
  syncOutlookCalendar,
  testOutlookCalendar,
  updateOutlookCalendarAutomation,
  type OutlookCalendarAutomation,
} from "@/api/automations";
import { apiUrl } from "@/api/client";
import {
  OAuthCalendarCard,
  type OAuthCalendarCardApi,
  type OAuthCalendarState,
} from "../OAuthCalendarCard";
import { CopyChip } from "./CopyChip";

const OUTLOOK_STEPS: ReactNode[] = [
  <>
    Register an app at{" "}
    <a href="https://entra.microsoft.com" target="_blank" rel="noreferrer">
      entra.microsoft.com
    </a>{" "}
    → App registrations → New registration.
  </>,
  <>
    Add a &quot;Web&quot; redirect URI:{" "}
    <CopyChip text={apiUrl("/api/automations/calendar/outlook/callback")} />
  </>,
  <>
    API permissions → Microsoft Graph → delegated{" "}
    <strong>Calendars.Read</strong>, then create a secret under Certificates
    &amp; secrets.
  </>,
  <>Paste the Application (client) ID and secret below and Save.</>,
];

function normalizeOutlook(next: OutlookCalendarAutomation): OAuthCalendarState {
  return {
    config: next.outlook,
    connection: next.connection,
    status: next.status,
    builtinApp: next.builtin_app ?? false,
  };
}

const outlookCalendarCardApi: OAuthCalendarCardApi = {
  get: async (signal) =>
    normalizeOutlook(await getOutlookCalendarAutomation(signal)),
  update: async (update) =>
    normalizeOutlook(await updateOutlookCalendarAutomation(update)),
  connect: connectOutlookCalendar,
  disconnect: async () => normalizeOutlook(await disconnectOutlookCalendar()),
  test: testOutlookCalendar,
  sync: syncOutlookCalendar,
};

/** Outlook / Microsoft 365 calendars over OAuth. */
export function OutlookCalendarConnection() {
  return (
    <OAuthCalendarCard
      provider="outlook"
      title="Outlook Calendar"
      blurb="Poll Outlook / Microsoft 365 calendars over OAuth — events land in the Inbox for triage. Read-only scope (Calendars.Read)."
      steps={OUTLOOK_STEPS}
      signInLabel="Sign in with Microsoft"
      clientIdPlaceholder="Application (client) ID — a GUID"
      calendarIdsPlaceholder="primary (default calendar)"
      api={outlookCalendarCardApi}
    />
  );
}
