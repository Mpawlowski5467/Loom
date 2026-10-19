import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import { useApp } from "../context/app-ctx";
import type {
  OnboardingCompleteRequest,
  OnboardingProviderPayload,
} from "../api/types";
import { cn } from "@/lib/utils";
import { useAppearance } from "../theme/appearance-ctx";
import { backendThemeName } from "../theme/backendTheme";
import { Welcome } from "./steps/Welcome";
import { VaultSetup } from "./steps/VaultSetup";
import { ThemePicker } from "./steps/ThemePicker";
import { ProviderConfig } from "./steps/ProviderConfig";

type StepName = "welcome" | "vault" | "theme" | "provider";
const STEP_ORDER: StepName[] = ["welcome", "vault", "theme", "provider"];

interface OnboardingDraft {
  vaultName: string;
  overwriteExistingVault: boolean;
  seedDemo: boolean;
  providers: OnboardingProviderPayload[];
  chatProvider: string | null;
  embedProvider: string | null;
}

export function OnboardingFlow(): ReactNode {
  const { completeOnboarding } = useApp();
  const { resolvedTheme } = useAppearance();
  const [step, setStep] = useState<StepName>("welcome");
  const [draft, setDraft] = useState<OnboardingDraft>({
    vaultName: "default",
    overwriteExistingVault: false,
    seedDemo: false,
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
        // The backend only knows the old theme names; see backendTheme.ts.
        theme: backendThemeName(resolvedTheme),
        vault_name: draft.vaultName.trim() || "default",
        overwrite_existing_vault: draft.overwriteExistingVault,
        seed_demo: draft.seedDemo,
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
  }, [completeOnboarding, draft, resolvedTheme]);

  return (
    <div
      className="fixed inset-0 overflow-y-auto bg-background"
      role="dialog"
      aria-labelledby="onboarding-title"
    >
      <div className="flex min-h-full items-center justify-center px-4 py-6 sm:px-6 sm:py-10">
        <div className="w-full max-w-xl animate-in rounded-xl border border-border bg-card px-5 pt-6 pb-5 text-card-foreground shadow-overlay duration-300 ease-[cubic-bezier(.2,.7,.3,1)] fade-in slide-in-from-bottom-2 sm:px-9 sm:pt-9 sm:pb-8">
          {/* Decorative: the sr-only title below says which step this is. */}
          <div className="mb-6 flex gap-2" aria-hidden="true">
            {STEP_ORDER.map((s, idx) => (
              <span
                key={s}
                className={cn(
                  "h-1 flex-1 rounded-full bg-border transition-colors duration-200 ease-[cubic-bezier(.2,.7,.3,1)]",
                  idx <= stepIndex && "bg-foreground",
                )}
              />
            ))}
          </div>
          <div id="onboarding-title" className="sr-only">
            Loom onboarding — step {stepIndex + 1} of {STEP_ORDER.length}
          </div>
          {step === "welcome" && <Welcome onNext={next} />}
          {step === "vault" && (
            <VaultSetup
              vaultName={draft.vaultName}
              overwriteExisting={draft.overwriteExistingVault}
              seedDemo={draft.seedDemo}
              onChange={(patch) =>
                updateDraft({
                  vaultName:
                    patch.vaultName !== undefined
                      ? patch.vaultName
                      : draft.vaultName,
                  overwriteExistingVault:
                    patch.overwriteExisting !== undefined
                      ? patch.overwriteExisting
                      : draft.overwriteExistingVault,
                  seedDemo:
                    patch.seedDemo !== undefined
                      ? patch.seedDemo
                      : draft.seedDemo,
                })
              }
              onNext={next}
              onBack={back}
            />
          )}
          {step === "theme" && <ThemePicker onNext={next} onBack={back} />}
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
    </div>
  );
}
