import type { ChangeEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "./kit/Field";
import { SettingsCard } from "./kit/SettingsCard";
import { SettingsGroup } from "./kit/SettingsGroup";
import { StatusLine } from "./kit/StatusLine";
import { ToggleField } from "./kit/ToggleField";
import { PolicyUsageCard } from "./general/PolicyUsageCard";
import { usePolicyForm } from "./general/usePolicyForm";

/** Settings → Privacy: bounds for unattended imports and cloud calls. */
export function PolicySection(): ReactNode {
  const form = usePolicyForm();
  const { policy, setPolicy, usage, loaded, busy, message } = form;

  const number =
    (field: "per_source_daily_capture_limit" | "daily_token_limit") =>
    (event: ChangeEvent<HTMLInputElement>) =>
      setPolicy((current) => ({
        ...current,
        [field]: Math.max(0, Number(event.target.value) || 0),
      }));

  return (
    <SettingsGroup
      level={1}
      title="Automation & privacy"
      description="Set bounds for unattended imports and cloud provider use."
    >
      <SettingsCard className="gap-4">
        <ToggleField
          label="Pause scheduled imports and processing"
          checked={policy.paused}
          onCheckedChange={(paused) => setPolicy({ ...policy, paused })}
        />
        <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
          <Field label="Daily captures per source (0 is unlimited)">
            <Input
              type="number"
              min="0"
              value={policy.per_source_daily_capture_limit}
              onChange={number("per_source_daily_capture_limit")}
            />
          </Field>
          <Field label="Daily estimated input-token limit (0 is unlimited)">
            <Input
              type="number"
              min="0"
              value={policy.daily_token_limit}
              onChange={number("daily_token_limit")}
            />
          </Field>
        </div>
      </SettingsCard>
      <SettingsCard className="gap-4">
        <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
          <Field label="Folders excluded from cloud calls">
            <Input
              value={form.folders}
              onChange={(event) => form.setFolders(event.target.value)}
              placeholder="private, people/medical"
            />
          </Field>
          <Field label="Tags excluded from cloud calls">
            <Input
              value={form.tags}
              onChange={(event) => form.setTags(event.target.value)}
              placeholder="private, confidential"
            />
          </Field>
        </div>
        <ToggleField
          label="Retain raw prompts and responses in traces"
          checked={policy.retain_raw_traces}
          onCheckedChange={(retain_raw_traces) =>
            setPolicy({ ...policy, retain_raw_traces })
          }
        />
        <p className="text-sm text-muted-foreground">
          Input allowances are checked before each provider attempt. Output
          tokens are counted afterward, so this is not a spending cap. Counts
          use a shared tokenizer and can differ from your provider bill. Raw
          retention affects new traces; existing traces keep their retention
          schedule.
        </p>
        <Field label="Optional blended USD price per 1,000 tokens by provider">
          <Textarea
            aria-label="Provider price estimates"
            className="min-h-20 font-mono"
            value={form.prices}
            onChange={(event) => form.setPrices(event.target.value)}
            placeholder={'{"openai": 0.01}'}
          />
        </Field>
      </SettingsCard>
      {usage && <PolicyUsageCard usage={usage} />}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          disabled={!loaded || busy}
          onClick={() => void form.submit()}
        >
          {busy ? "Saving…" : "Save policy"}
        </Button>
        {message && <StatusLine>{message}</StatusLine>}
      </div>
    </SettingsGroup>
  );
}
