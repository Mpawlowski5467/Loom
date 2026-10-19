import { Input } from "@/components/ui/input";
import { Field } from "@/views/settings/kit/Field";
import { SettingsCard } from "@/views/settings/kit/SettingsCard";
import { SettingsGroup } from "@/views/settings/kit/SettingsGroup";
import { AlertLine } from "./AlertLine";
import { EnableSwitch } from "./EnableSwitch";
import { FIELD_ROW, NOTE } from "./styles";
import type { StandupAutomationState } from "./useStandupAutomation";

/** The daily Standup schedule: on/off, run time and timezone. */
export function StandupCard({ standup }: { standup: StandupAutomationState }) {
  const status = standup.automation?.status;
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
