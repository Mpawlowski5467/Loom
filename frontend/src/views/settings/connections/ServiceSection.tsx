import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/views/settings/kit/Field";
import { SettingsGroup } from "@/views/settings/kit/SettingsGroup";
import { StatusLine } from "@/views/settings/kit/StatusLine";
import { AlertLine } from "./AlertLine";
import { EnableSwitch } from "./EnableSwitch";
import { PollStatus } from "./PollStatus";
import { ACTION_ROW, FIELD_ROW, SERVICE_BLOCK } from "./styles";
import type { ServiceStatusLine } from "./types";
import {
  useServiceSection,
  type ServiceSectionOptions,
} from "./useServiceSection";

interface ServiceSectionProps extends ServiceSectionOptions {
  title: string;
  blurb: string;
  status: ServiceStatusLine | undefined;
  /** Shows the calendar IDs field (calendar services only). */
  calendarIdsPlaceholder?: string;
}

/** One service of a connected account (Calendar, Gmail, Outlook Calendar). */
export function ServiceSection({
  title,
  blurb,
  status,
  calendarIdsPlaceholder,
  ...options
}: ServiceSectionProps) {
  const service = useServiceSection(options);
  const { serviceLabel } = options;
  const { busy, inactive } = service;

  return (
    <SettingsGroup
      level={3}
      title={title}
      description={blurb}
      className={SERVICE_BLOCK}
      actions={
        <EnableSwitch
          label={`Enable ${serviceLabel}`}
          checked={service.enabled}
          onCheckedChange={service.setEnabled}
          disabled={inactive}
        />
      }
    >
      {calendarIdsPlaceholder !== undefined && (
        <Field label="Calendar IDs — one per line (optional)">
          <Textarea
            className="min-h-16 font-mono"
            value={service.calendarIds}
            onChange={(event) => service.setCalendarIds(event.target.value)}
            placeholder={calendarIdsPlaceholder}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
      )}
      <div className={FIELD_ROW}>
        <Field label="Poll interval (minutes)">
          <Input
            type="number"
            min={5}
            max={1440}
            value={service.intervalMinutes}
            onChange={(event) => service.setIntervalMinutes(event.target.value)}
          />
        </Field>
        <Field label="Lookback (days)">
          <Input
            type="number"
            min={1}
            max={90}
            value={service.lookbackDays}
            onChange={(event) => service.setLookbackDays(event.target.value)}
          />
        </Field>
      </div>
      <div className={ACTION_ROW}>
        <Button
          type="button"
          size="sm"
          aria-label={`Save ${serviceLabel} settings`}
          onClick={() => void service.save()}
          disabled={inactive}
        >
          {busy === "save" ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Test ${serviceLabel} connection`}
          onClick={() => void service.test()}
          disabled={inactive}
        >
          {busy === "test" ? "Testing…" : "Test connection"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Sync ${serviceLabel} now`}
          onClick={() => void service.sync()}
          disabled={inactive}
        >
          <RefreshCw aria-hidden="true" />
          {busy === "sync" ? "Syncing…" : "Sync now"}
        </Button>
      </div>
      {service.error && <AlertLine>{service.error}</AlertLine>}
      {service.testResult && (
        <StatusLine tone={service.testResult.ok ? "ok" : "error"}>
          {service.testResult.ok
            ? `Connected — ${service.testResult.account || "account reachable"}`
            : service.testResult.error}
        </StatusLine>
      )}
      {service.errorLines.map((line) => (
        <AlertLine key={line}>{line}</AlertLine>
      ))}
      <PollStatus status={status} />
    </SettingsGroup>
  );
}
