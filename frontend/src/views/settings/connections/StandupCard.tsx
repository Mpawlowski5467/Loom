import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/views/settings/kit/Field";
import { SettingsCard } from "@/views/settings/kit/SettingsCard";
import { SettingsGroup } from "@/views/settings/kit/SettingsGroup";
import { StatusLine } from "@/views/settings/kit/StatusLine";
import { AlertLine } from "./AlertLine";
import { EnableSwitch } from "./EnableSwitch";
import { ACTION_ROW, FIELD_ROW, NOTE } from "./styles";
import type { StandupAutomationState } from "./useStandupAutomation";

/** Beside Save: a failed save, else unsaved edits, else the last save. */
function saveStatus({ scheduleStatus, scheduleDirty }: StandupAutomationState) {
  if (scheduleStatus?.tone === "error" || !scheduleDirty) return scheduleStatus;
  return { tone: "warn", text: "Unsaved changes" } as const;
}

/** The daily Standup schedule: on/off, run time and timezone, saved here. */
export function StandupCard({ standup }: { standup: StandupAutomationState }) {
  const status = standup.automation?.status;
  const saved = saveStatus(standup);
  return (
    <SettingsGroup
      title="Daily Standup"
      description="Generates one deduplicated Standup capture for each local day."
      actions={
        <EnableSwitch
          label="Schedule daily Standup"
          onText="Scheduled"
          checked={standup.scheduleEnabled}
          onCheckedChange={standup.setScheduleEnabled}
          disabled={!standup.automation || standup.busy !== null}
        />
      }
    >
      <SettingsCard>
        <div className={FIELD_ROW}>
          <Field label="Run time">
            <Input
              type="time"
              value={standup.runTime}
              onChange={(event) => standup.setRunTime(event.target.value)}
            />
          </Field>
          <Field label="Timezone">
            <Input
              value={standup.timezone}
              onChange={(event) => standup.setTimezone(event.target.value)}
              placeholder="America/Chicago"
              spellCheck={false}
            />
          </Field>
        </div>
        <div className={ACTION_ROW}>
          <Button
            type="button"
            size="sm"
            aria-label="Save Standup schedule"
            onClick={() => void standup.saveSchedule()}
            disabled={!standup.automation || standup.busy !== null}
          >
            {standup.busy === "schedule" ? "Saving…" : "Save"}
          </Button>
          {saved && <StatusLine tone={saved.tone}>{saved.text}</StatusLine>}
        </div>
        {status?.next_run_at && (
          <p className={NOTE}>
            Next run {new Date(status.next_run_at).toLocaleString()}
          </p>
        )}
        {status?.state.last_success_at && (
          <p className={NOTE}>
            Last completed{" "}
            {new Date(status.state.last_success_at).toLocaleString()}
          </p>
        )}
        {status?.state.last_error && (
          <AlertLine>Last run: {status.state.last_error}</AlertLine>
        )}
      </SettingsCard>
    </SettingsGroup>
  );
}
