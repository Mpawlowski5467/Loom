import { Link2Off, RefreshCw } from "lucide-react";
import type { CalendarTestResult } from "@/api/automations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/views/settings/kit/Field";
import { SettingsCard } from "@/views/settings/kit/SettingsCard";
import { SettingsGroup } from "@/views/settings/kit/SettingsGroup";
import { AlertLine } from "./AlertLine";
import { CheckboxField } from "./CheckboxField";
import { EnableSwitch } from "./EnableSwitch";
import { FieldBadge } from "./FieldBadge";
import { ACTION_ROW, FIELD_ROW, RESULT_PANEL } from "./styles";
import type { StandupAutomationState } from "./useStandupAutomation";

/** The first few events a feed test found today. */
function EventPreview({ result }: { result: CalendarTestResult }) {
  return (
    <div role="status" aria-live="polite" className={RESULT_PANEL}>
      <strong className="font-medium text-foreground">
        {result.event_count} event
        {result.event_count === 1 ? "" : "s"} found
      </strong>
      {result.events.slice(0, 5).map((event) => (
        <span key={event.external_id}>
          {event.all_day
            ? "All day"
            : new Date(event.start).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}{" "}
          · {event.title}
        </span>
      ))}
    </div>
  );
}

/** A private iCalendar feed: Standup context and event captures. */
export function CalendarFeedCard({
  standup,
}: {
  standup: StandupAutomationState;
}) {
  const { automation, busy } = standup;
  const connected = automation?.calendar.feed_url_set ?? false;
  const noFeed = !connected && !standup.feedUrl.trim();

  return (
    <SettingsGroup
      title="Calendar feed"
      description="Works with private iCal links from Google, Outlook, Apple, and CalDAV."
      actions={
        <EnableSwitch
          label="Enable calendar connection"
          checked={standup.calendarEnabled}
          onCheckedChange={standup.setCalendarEnabled}
          disabled={!automation || busy !== null}
        />
      }
    >
      <SettingsCard>
        <div className={FIELD_ROW}>
          <Field label="Calendar name">
            <Input
              value={standup.calendarName}
              onChange={(event) => standup.setCalendarName(event.target.value)}
            />
          </Field>
          <Field
            label={
              <>
                Private iCalendar URL{" "}
                {connected && <FieldBadge>connected</FieldBadge>}
              </>
            }
          >
            <Input
              type="url"
              value={standup.feedUrl}
              onChange={(event) => standup.setFeedUrl(event.target.value)}
              placeholder={
                connected
                  ? "Paste a new URL to replace the saved feed"
                  : "webcal://… or https://…"
              }
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        </div>
        <CheckboxField
          label="Include events in Standup context"
          hint="Event text is treated as untrusted source data."
          checked={standup.includeInStandup}
          onCheckedChange={standup.setIncludeInStandup}
        />
        <CheckboxField
          label="Create Inbox captures for events"
          hint="Stable event IDs prevent duplicate jobs."
          checked={standup.createCaptures}
          onCheckedChange={standup.setCreateCaptures}
        />

        <div className={ACTION_ROW}>
          <Button
            type="button"
            size="sm"
            onClick={() => void standup.save()}
            disabled={!automation || busy !== null}
          >
            {busy === "save" ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void standup.test()}
            disabled={!automation || busy !== null || noFeed}
          >
            {busy === "test" ? "Testing…" : "Test connection"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void standup.sync()}
            disabled={!automation || busy !== null || noFeed}
          >
            <RefreshCw aria-hidden="true" />
            {busy === "sync" ? "Syncing…" : "Sync today"}
          </Button>
          {connected && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void standup.disconnect()}
              disabled={busy !== null}
            >
              <Link2Off aria-hidden="true" /> Disconnect
            </Button>
          )}
        </div>

        {standup.error && <AlertLine>{standup.error}</AlertLine>}
        {standup.testResult && <EventPreview result={standup.testResult} />}
      </SettingsCard>
    </SettingsGroup>
  );
}
