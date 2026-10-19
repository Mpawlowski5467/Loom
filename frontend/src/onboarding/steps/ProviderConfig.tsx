import { useState } from "react";
import type { ReactNode } from "react";
import type { OnboardingProviderPayload } from "@/api/types";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Button } from "@/components/ui/button";
import { Step, StepActions, StepHeader } from "../StepLayout";
import { ProviderDefaults } from "./provider/ProviderDefaults";
import { ProviderForm } from "./provider/ProviderForm";
import { ProviderPicker } from "./provider/ProviderPicker";
import {
  providerMeta,
  togglePatch,
  type DraftPatch,
  type ProviderOption,
} from "./provider/providerOptions";
import { useConnectionTests } from "./provider/useConnectionTests";

interface Props {
  providers: OnboardingProviderPayload[];
  chatProvider: string | null;
  embedProvider: string | null;
  onChange: (patch: DraftPatch) => void;
  onSubmit: () => void;
  onBack: () => void;
  submitting: boolean;
  submitError: string | null;
}

export function ProviderConfig({
  providers,
  chatProvider,
  embedProvider,
  onChange,
  onSubmit,
  onBack,
  submitting,
  submitError,
}: Props): ReactNode {
  const tests = useConnectionTests();
  // Accessible confirm dialog (replaces window.confirm) for skipping setup.
  const [confirmSkip, setConfirmSkip] = useState(false);

  const togglePicked = (opt: ProviderOption) => {
    onChange(togglePatch(opt, providers, chatProvider, embedProvider));
    tests.clear(opt.name);
  };

  const patchProvider = (
    name: string,
    update: Partial<OnboardingProviderPayload>,
  ) => {
    onChange({
      providers: providers.map((p) =>
        p.name === name ? { ...p, ...update } : p,
      ),
    });
    tests.clear(name);
  };

  // Runs after the user confirms in the modal: clear any drafted providers and
  // submit so onboarding finishes in the offline (no-provider) state.
  const skipConfirmed = () => {
    onChange({ providers: [], chatProvider: null, embedProvider: null });
    onSubmit();
  };

  // Finish requires the chosen chat + embed providers to have a passing
  // connection test, so you can't land in an app where every agent silently
  // fails on an empty or bad key. The Skip button is the explicit escape.
  const canFinish =
    providers.length > 0 &&
    !!chatProvider &&
    !!embedProvider &&
    tests.passed(chatProvider) &&
    tests.passed(embedProvider);
  const finishHint =
    providers.length > 0 && !canFinish
      ? "Test your chat and embed providers to finish — or Skip for now."
      : null;

  return (
    <Step>
      <StepHeader
        title="Hook up AI providers"
        description="You can configure more than one. Pick the default for chat and the default for embeddings — they can be different providers."
      />
      <p className="-mt-2 text-xs/relaxed text-muted-foreground">
        Keys are encrypted before they are stored in{" "}
        <code className="font-mono">config.yaml</code> on this machine. The
        machine-local encryption key remains in your Loom home directory.
      </p>

      <ProviderPicker providers={providers} onToggle={togglePicked} />

      {providers.map((prov) => {
        const meta = providerMeta(prov.name);
        if (!meta) return null;
        return (
          <ProviderForm
            key={prov.name}
            provider={prov}
            meta={meta}
            result={tests.results[prov.name] ?? null}
            testing={tests.testing === prov.name}
            onPatch={(update) => patchProvider(prov.name, update)}
            onTest={() => void tests.run(prov)}
          />
        );
      })}

      {providers.length > 0 && (
        <ProviderDefaults
          providers={providers}
          chatProvider={chatProvider}
          embedProvider={embedProvider}
          onChange={onChange}
        />
      )}

      {submitError && (
        <p
          role="alert"
          className="rounded-md border border-danger-foreground/40 px-3 py-2 font-mono text-xs wrap-break-word text-danger-foreground"
        >
          {submitError}
        </p>
      )}
      {finishHint && (
        <p className="font-mono text-xs text-muted-foreground sm:text-right">
          {finishHint}
        </p>
      )}

      <StepActions>
        <Button variant="ghost" onClick={onBack} disabled={submitting}>
          ← Back
        </Button>
        <Button
          variant="outline"
          type="button"
          onClick={() => setConfirmSkip(true)}
          disabled={submitting}
        >
          Skip for now
        </Button>
        <Button onClick={onSubmit} disabled={submitting || !canFinish}>
          {submitting ? "Saving…" : "Finish →"}
        </Button>
      </StepActions>

      {confirmSkip && (
        <ConfirmModal
          title="Skip provider setup?"
          body="Agents, search, and graph linking stay offline until you add a provider in Settings → Models & providers."
          confirmLabel="Skip for now"
          destructive={false}
          onConfirm={skipConfirmed}
          onClose={() => setConfirmSkip(false)}
        />
      )}
    </Step>
  );
}
