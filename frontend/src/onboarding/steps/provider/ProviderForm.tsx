import { useId } from "react";
import type { ReactNode } from "react";
import { CircleCheck, CircleX } from "lucide-react";
import type {
  OnboardingProviderPayload,
  TestProviderResponse,
} from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Field } from "../../StepLayout";
import type { ProviderOption } from "./providerOptions";

interface ProviderFormProps {
  provider: OnboardingProviderPayload;
  meta: ProviderOption;
  result: TestProviderResponse | null;
  testing: boolean;
  onPatch: (update: Partial<OnboardingProviderPayload>) => void;
  onTest: () => void;
}

/** Key, host and models for one picked provider, with a connection test. */
export function ProviderForm({
  provider: prov,
  meta,
  result,
  testing,
  onPatch,
  onTest,
}: ProviderFormProps): ReactNode {
  const id = useId();
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold text-foreground">{meta.label}</h3>
      {meta.requiresApiKey && (
        <Field id={`${id}-key`} label="API key">
          <Input
            id={`${id}-key`}
            className="font-mono"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={prov.api_key ?? ""}
            onChange={(e) => onPatch({ api_key: e.target.value })}
            placeholder="sk-…"
          />
        </Field>
      )}
      {meta.requiresHost && (
        <Field id={`${id}-host`} label="Host">
          <Input
            id={`${id}-host`}
            className="font-mono"
            type="text"
            value={prov.host ?? ""}
            onChange={(e) => onPatch({ host: e.target.value })}
            placeholder={meta.defaultHost}
          />
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${id}-chat`} label="Chat model">
          <Input
            id={`${id}-chat`}
            className="font-mono"
            type="text"
            value={prov.chat_model ?? ""}
            onChange={(e) => onPatch({ chat_model: e.target.value })}
            placeholder={meta.defaultChat ?? ""}
          />
        </Field>
        <Field id={`${id}-embed`} label="Embed model">
          <Input
            id={`${id}-embed`}
            className="font-mono"
            type="text"
            value={prov.embed_model ?? ""}
            onChange={(e) => onPatch({ embed_model: e.target.value })}
            placeholder={meta.defaultEmbed ?? "—"}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          type="button"
          onClick={onTest}
          disabled={testing}
        >
          {testing ? "Testing…" : "Test connection"}
        </Button>
        {result && (
          <span
            className={cn(
              "flex min-w-0 items-center gap-1.5 font-mono text-xs wrap-break-word",
              result.ok ? "text-ok-foreground" : "text-danger-foreground",
            )}
            role="status"
            aria-live="polite"
          >
            {result.ok ? (
              <CircleCheck aria-hidden="true" className="size-3.5 shrink-0" />
            ) : (
              <CircleX aria-hidden="true" className="size-3.5 shrink-0" />
            )}
            {result.ok
              ? `OK — ${result.latency_ms}ms`
              : `Failed — ${result.error ?? "unknown"}`}
          </span>
        )}
      </div>
    </div>
  );
}
