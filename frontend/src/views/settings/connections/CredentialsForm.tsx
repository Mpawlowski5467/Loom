import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/views/settings/kit/Field";
import { FieldBadge } from "./FieldBadge";
import { ACTION_ROW, FIELD_ROW } from "./styles";

interface CredentialsFormProps {
  clientId: string;
  clientSecret: string;
  secretSaved: boolean;
  clientIdPlaceholder: string;
  busy: boolean;
  onClientIdChange: (value: string) => void;
  onClientSecretChange: (value: string) => void;
  onSave: () => void;
  onCancel?: () => void;
}

/** The OAuth client ID and secret, with Save (and Cancel when editing). */
export function CredentialsForm({
  clientId,
  clientSecret,
  secretSaved,
  clientIdPlaceholder,
  busy,
  onClientIdChange,
  onClientSecretChange,
  onSave,
  onCancel,
}: CredentialsFormProps) {
  return (
    <>
      <div className={FIELD_ROW}>
        <Field label="Client ID">
          <Input
            value={clientId}
            onChange={(event) => onClientIdChange(event.target.value)}
            placeholder={clientIdPlaceholder}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field
          label={
            <>
              Client secret{" "}
              {secretSaved && <FieldBadge>secret saved</FieldBadge>}
            </>
          }
        >
          <Input
            type="password"
            value={clientSecret}
            onChange={(event) => onClientSecretChange(event.target.value)}
            placeholder={
              secretSaved
                ? "Leave blank to keep current"
                : "OAuth client secret"
            }
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
      </div>
      <div className={ACTION_ROW}>
        <Button
          type="button"
          size="sm"
          aria-label="Save credentials"
          onClick={onSave}
          disabled={busy}
        >
          {busy ? "Saving…" : "Save"}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
        )}
      </div>
    </>
  );
}
