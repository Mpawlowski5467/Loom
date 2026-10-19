import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Field } from "@/views/settings/kit/Field";
import { CheckboxField } from "./CheckboxField";
import { FieldBadge } from "./FieldBadge";
import { FIELD_ROW } from "./styles";
import type { EmailBridgeState } from "./useEmailBridge";

/** A text input that isn't autocompleted or spell-checked. */
function PlainInput({
  value,
  onChange,
  placeholder,
  type,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "password";
}) {
  return (
    <Input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
    />
  );
}

function NumberInput({
  min,
  max,
  value,
  onChange,
}: {
  min: number;
  max: number;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className={FIELD_ROW}>{children}</div>;
}

/** The mailbox, credentials and polling fields of the email bridge. */
export function EmailFields({ bridge }: { bridge: EmailBridgeState }) {
  return (
    <>
      <Row>
        <Field label="IMAP host">
          <PlainInput
            value={bridge.host}
            onChange={bridge.setHost}
            placeholder="imap.example.com"
          />
        </Field>
        <Field label="Port">
          <NumberInput
            min={1}
            max={65535}
            value={bridge.port}
            onChange={bridge.setPort}
          />
        </Field>
      </Row>
      <Row>
        <Field label="Username">
          <PlainInput
            value={bridge.username}
            onChange={bridge.setUsername}
            placeholder="you@example.com"
          />
        </Field>
        <Field
          label={
            <>
              Password{" "}
              {bridge.passwordSaved && <FieldBadge>password saved</FieldBadge>}
            </>
          }
        >
          <PlainInput
            type="password"
            value={bridge.password}
            onChange={bridge.setPassword}
            placeholder={
              bridge.passwordSaved
                ? "Leave blank to keep current"
                : "App password"
            }
          />
        </Field>
      </Row>
      <Row>
        <Field label="Folder">
          <PlainInput
            value={bridge.folder}
            onChange={bridge.setFolder}
            placeholder="INBOX"
          />
        </Field>
        <Field label="Max messages per poll">
          <NumberInput
            min={1}
            max={100}
            value={bridge.maxMessages}
            onChange={bridge.setMaxMessages}
          />
        </Field>
      </Row>
      <Row>
        <Field label="Poll interval (minutes)">
          <NumberInput
            min={5}
            max={1440}
            value={bridge.intervalMinutes}
            onChange={bridge.setIntervalMinutes}
          />
        </Field>
        <Field label="Lookback (hours)">
          <NumberInput
            min={1}
            max={720}
            value={bridge.lookbackHours}
            onChange={bridge.setLookbackHours}
          />
        </Field>
      </Row>
      <CheckboxField
        label="Use SSL"
        hint="Standard for port 993; disable only for plaintext IMAP."
        checked={bridge.useSsl}
        onCheckedChange={bridge.setUseSsl}
      />
    </>
  );
}
