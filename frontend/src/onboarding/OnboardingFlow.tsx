import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "../context/app-ctx";
import type {
  OnboardingCompleteRequest,
  OnboardingProviderPayload,
} from "../api/types";
import type { ThemeName } from "../theme/themes";
import { Welcome } from "./steps/Welcome";
import { VaultSetup } from "./steps/VaultSetup";
import { ThemePicker } from "./steps/ThemePicker";
import { ProviderConfig } from "./steps/ProviderConfig";

type StepName = "welcome" | "vault" | "theme" | "provider";
const STEP_ORDER: StepName[] = ["welcome", "vault", "theme", "provider"];

interface OnboardingDraft {
  theme: ThemeName;
  vaultName: string;
  overwriteExistingVault: boolean;
  providers: OnboardingProviderPayload[];
  chatProvider: string | null;
  embedProvider: string | null;
}

export function OnboardingFlow(): ReactNode {
  const { theme, completeOnboarding } = useApp();
  const [step, setStep] = useState<StepName>("welcome");
  const [draft, setDraft] = useState<OnboardingDraft>({
    theme,
    vaultName: "default",
    overwriteExistingVault: false,
    providers: [],
    chatProvider: null,
    embedProvider: null,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const stepIndex = STEP_ORDER.indexOf(step);
  const goto = (next: StepName) => {
    setSubmitError(null);
    setStep(next);
  };
  const next = () => {
    if (stepIndex < STEP_ORDER.length - 1) goto(STEP_ORDER[stepIndex + 1]!);
  };
  const back = () => {
    if (stepIndex > 0) goto(STEP_ORDER[stepIndex - 1]!);
  };

  const updateDraft = useCallback((patch: Partial<OnboardingDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  const submit = useCallback(async () => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const payload: OnboardingCompleteRequest = {
        theme: draft.theme,
        vault_name: draft.vaultName.trim() || "default",
        overwrite_existing_vault: draft.overwriteExistingVault,
        providers: draft.providers,
        chat_provider: draft.chatProvider,
        embed_provider: draft.embedProvider,
        steps_done: STEP_ORDER,
      };
      await completeOnboarding(payload);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Failed to save onboarding",
      );
    } finally {
      setSubmitting(false);
    }
  }, [completeOnboarding, draft]);

  return (
    <div className="onb-root" role="dialog" aria-labelledby="onb-title">
      <div className="onb-card">
        <div className="onb-progress" aria-label="Step progress">
          {STEP_ORDER.map((s, idx) => (
            <span
              key={s}
              className={`onb-progress-dot ${
                idx <= stepIndex ? "active" : ""
              }`}
              aria-hidden="true"
            />
          ))}
        </div>
        <div id="onb-title" className="sr-only">
          Loom onboarding — step {stepIndex + 1} of {STEP_ORDER.length}
        </div>
        {step === "welcome" && <Welcome onNext={next} />}
        {step === "vault" && (
          <VaultSetup
            vaultName={draft.vaultName}
            overwriteExisting={draft.overwriteExistingVault}
            onChange={(patch) =>
              updateDraft({
                vaultName:
                  patch.vaultName !== undefined ? patch.vaultName : draft.vaultName,
                overwriteExistingVault:
                  patch.overwriteExisting !== undefined
                    ? patch.overwriteExisting
                    : draft.overwriteExistingVault,
              })
            }
            onNext={next}
            onBack={back}
          />
        )}
        {step === "theme" && (
          <ThemePicker
            selected={draft.theme}
            onChange={(t) => updateDraft({ theme: t })}
            onNext={next}
            onBack={back}
          />
        )}
        {step === "provider" && (
          <ProviderConfig
            providers={draft.providers}
            chatProvider={draft.chatProvider}
            embedProvider={draft.embedProvider}
            onChange={(patch) => updateDraft(patch)}
            onSubmit={submit}
            onBack={back}
            submitting={submitting}
            submitError={submitError}
          />
        )}
      </div>
    </div>
  );
}
