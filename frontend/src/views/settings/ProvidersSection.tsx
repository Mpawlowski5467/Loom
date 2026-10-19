import type { ReactNode } from "react";
import { KeyRound, Save, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SettingsGroup } from "./kit/SettingsGroup";
import { StatusLine } from "./kit/StatusLine";
import { DefaultProviderPicker } from "./models/DefaultProviderPicker";
import { connectionLabel, mergeModelIds } from "./models/providerHelpers";
import { useLiveModels } from "./models/useLiveModels";
import { useProviderAuth } from "./models/useProviderAuth";
import { useProviderForms } from "./models/useProviderForms";
import { ProviderAccordion } from "./ProviderAccordion";
import { PROVIDERS } from "./providerModels";

/** Settings → Models & providers: connect providers and pick the default. */
export function ProvidersSection(): ReactNode {
  const forms = useProviderForms();
  const { authBusy, codexStatus, connectCodex, connectOpenRouter } =
    useProviderAuth(forms);
  const liveModels = useLiveModels(forms.openName, forms.providers);
  const { providers, configuredNames } = forms;

  return (
    <SettingsGroup level={1} title="AI Providers">
      <Alert role="note">
        <KeyRound aria-hidden="true" />
        <AlertTitle className="line-clamp-none">
          Connect directly where the provider supports it.
        </AlertTitle>
        <AlertDescription>
          Codex uses ChatGPT sign-in and OpenRouter uses browser OAuth. Other
          model APIs currently issue API keys instead; Loom labels those
          separately. Keys are encrypted at rest with a machine-local key.
        </AlertDescription>
      </Alert>
      <DefaultProviderPicker
        names={configuredNames}
        value={forms.defaultProvider}
        onChange={(name) => void forms.selectDefault(name)}
      />
      {forms.embedProviderMissing && (
        <Alert variant="warning" role="status">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle className="line-clamp-none text-warning-foreground">
            No embedding provider.
          </AlertTitle>
          <AlertDescription className="text-warning-foreground">
            The configured providers are chat-only — Loom's index will fail. Add
            OpenAI or Ollama to enable search and graph linking.
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col gap-2.5">
        {PROVIDERS.map((meta) => {
          const provider = providers[meta.name];
          const live = liveModels[meta.name];
          return (
            <ProviderAccordion
              key={meta.name}
              meta={meta}
              provider={provider}
              open={forms.openName === meta.name}
              count={configuredNames.length}
              test={forms.tests[meta.name]}
              testing={forms.testing === meta.name}
              authBusy={authBusy === meta.name}
              connectionLabel={connectionLabel(
                meta.name,
                provider,
                codexStatus,
              )}
              chatOptions={mergeModelIds(
                meta.chatModels,
                live?.chat.map((model) => model.id) ?? [],
                provider?.chatModel,
              )}
              embedOptions={mergeModelIds(
                meta.embedModels,
                live?.embed.map((model) => model.id) ?? [],
                provider?.embedModel,
              )}
              onToggle={() => forms.setOpenName(meta.name)}
              onAdd={() => forms.addProvider(meta.name)}
              onPatch={(patch) => forms.patchProvider(meta.name, patch)}
              onRemove={() => forms.removeProvider(meta.name)}
              onTest={() => void forms.runTest(meta.name)}
              onConnect={
                meta.name === "codex"
                  ? () => void connectCodex()
                  : meta.name === "openrouter"
                    ? () => void connectOpenRouter()
                    : undefined
              }
            />
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          onClick={() => void forms.save()}
          disabled={forms.saving || forms.loading}
        >
          <Save aria-hidden="true" />
          {forms.saving ? "Saving…" : "Save providers"}
        </Button>
        {forms.message && <StatusLine>{forms.message}</StatusLine>}
      </div>
    </SettingsGroup>
  );
}
