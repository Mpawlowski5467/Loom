import { useState } from "react";
import { testProvider } from "@/api/providers";
import type {
  OnboardingProviderPayload,
  TestProviderResponse,
} from "@/api/types";

/** Connection-test results per provider, and the one being tested. */
export function useConnectionTests() {
  const [results, setResults] = useState<
    Record<string, TestProviderResponse | null>
  >({});
  const [testing, setTesting] = useState<string | null>(null);

  /** Forget a provider's result after its settings change. */
  const clear = (name: string) =>
    setResults((prev) => ({ ...prev, [name]: null }));

  const run = async (prov: OnboardingProviderPayload) => {
    setTesting(prov.name);
    try {
      const result = await testProvider(prov.name, {
        api_key: prov.api_key ?? "",
        host: prov.host ?? "",
      });
      setResults((prev) => ({ ...prev, [prov.name]: result }));
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        [prov.name]: {
          ok: false,
          latency_ms: 0,
          error: err instanceof Error ? err.message : "Test failed",
        },
      }));
    } finally {
      setTesting(null);
    }
  };

  const passed = (name: string | null): boolean =>
    !!name && results[name]?.ok === true;

  return { results, testing, run, clear, passed };
}
