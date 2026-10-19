import { useId } from "react";
import { ExternalLink, Link2, TestTube2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field } from "../kit/Field";
import { StatusLine } from "../kit/StatusLine";
import { ModelCombobox } from "../ModelCombobox";
import type { ProviderForm } from "../providerModels";
import { ConnectNote } from "./ConnectNote";
import type { ProviderAccordionProps } from "./providerCardProps";

type ProviderFormFieldsProps = ProviderAccordionProps & {
  provider: ProviderForm;
  deleteDisabled: boolean;
};

/** A configured provider's credential, endpoint and model fields. */
export function ProviderFormFields(props: ProviderFormFieldsProps) {
  const { meta, provider } = props;
  const connectAction = (label: string) => (
    <Button
      variant="outline"
      size="sm"
      type="button"
      onClick={props.onConnect}
      disabled={props.authBusy}
    >
      <Link2 aria-hidden="true" />
      {props.authBusy ? "Opening…" : label}
    </Button>
  );
  return (
    <>
      {meta.authMode === "codex" && (
        <ConnectNote
          title="Local Codex integration"
          action={connectAction("Connect Codex")}
        >
          Uses Codex's own ChatGPT sign-in and credential store. Loom never
          reads or copies those tokens. Chat only; embeddings still need a
          separate provider.
        </ConnectNote>
      )}
      {(meta.authMode === "api_key" || meta.authMode === "oauth_pkce") && (
        <ApiKeyField {...props} />
      )}
      {meta.authMode === "oauth_pkce" && (
        <ConnectNote
          title="One-click connection"
          action={connectAction("Connect OpenRouter")}
        >
          OpenRouter will ask you to approve Loom, then creates a dedicated API
          key that Loom encrypts locally.
        </ConnectNote>
      )}
      {meta.authMode === "local" && (
        <Field label="Host">
          <Input
            className="font-mono"
            type="text"
            value={provider.host}
            placeholder={meta.defaultHost}
            onChange={(e) => props.onPatch({ host: e.target.value })}
          />
        </Field>
      )}
      {meta.supportsBaseUrl && (
        <Field
          label="API base URL"
          hint={
            <>
              Leave blank to use{" "}
              <span className="font-mono">{meta.defaultBaseUrl}</span>.
            </>
          }
        >
          <Input
            className="font-mono"
            type="text"
            value={provider.baseUrl}
            placeholder={meta.defaultBaseUrl}
            onChange={(e) => props.onPatch({ baseUrl: e.target.value })}
          />
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <ModelCombobox
          label="Chat model"
          value={provider.chatModel}
          options={props.chatOptions ?? meta.chatModels}
          onChange={(chatModel) => props.onPatch({ chatModel })}
        />
        <ModelCombobox
          label="Embed model"
          value={provider.embedModel}
          options={props.embedOptions ?? meta.embedModels}
          disabled={!meta.supportsEmbed}
          onChange={(embedModel) => props.onPatch({ embedModel })}
        />
      </div>
      <ProviderActions {...props} />
    </>
  );
}

function ApiKeyField({ meta, provider, onPatch }: ProviderFormFieldsProps) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id}>API key</Label>
        <a
          className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-brand hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          href={meta.credentialUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {meta.authMode === "oauth_pkce"
            ? "Create manually"
            : "Create API key"}
          <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      </div>
      <Input
        id={id}
        className="font-mono"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={provider.apiKey}
        placeholder={provider.apiKeySet ? "Key is set" : "API key"}
        onChange={(e) => onPatch({ apiKey: e.target.value })}
      />
    </div>
  );
}

function ProviderActions(props: ProviderFormFieldsProps) {
  const { test } = props;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={props.onTest}
          disabled={props.testing}
        >
          <TestTube2 aria-hidden="true" />
          {props.testing ? "Testing…" : "Test"}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          type="button"
          onClick={props.onRemove}
          disabled={props.deleteDisabled}
          title={
            props.deleteDisabled
              ? "At least one provider must be configured."
              : undefined
          }
        >
          <Trash2 aria-hidden="true" />
          Delete
        </Button>
        {props.deleteDisabled && (
          <span className="text-xs text-muted-foreground">
            At least one provider must be configured.
          </span>
        )}
      </div>
      {test && (
        <StatusLine tone={test.ok ? "ok" : "error"} className="font-mono">
          {test.ok
            ? `OK — ${test.latency_ms}ms`
            : `Failed — ${test.error ?? "unknown"}`}
        </StatusLine>
      )}
    </>
  );
}
