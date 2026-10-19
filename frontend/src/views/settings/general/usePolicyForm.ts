import { useEffect, useState } from "react";
import {
  type AutomationPolicy,
  type PolicyUsage,
  getPolicy,
  savePolicy,
} from "@/api/policy";
import { describeApiError } from "@/api/client";

const EMPTY: AutomationPolicy = {
  paused: false,
  per_source_daily_capture_limit: 0,
  daily_token_limit: 0,
  excluded_cloud_folders: [],
  excluded_cloud_tags: [],
  retain_raw_traces: false,
  provider_prices_per_1k: {},
};

function csv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePrices(prices: string): Record<string, number> {
  const parsed: unknown = JSON.parse(prices);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.values(parsed).some(
      (value) =>
        typeof value !== "number" || !Number.isFinite(value) || value < 0,
    )
  )
    throw new Error(
      "Prices must be a JSON object of provider names and nonnegative amounts per 1,000 tokens.",
    );
  return parsed as Record<string, number>;
}

/**
 * The automation policy form: loads the policy and today's usage, keeps the
 * comma lists and price JSON as editable text, and saves them parsed.
 */
export function usePolicyForm() {
  const [policy, setPolicy] = useState<AutomationPolicy>(EMPTY);
  const [message, setMessage] = useState("");
  const [usage, setUsage] = useState<PolicyUsage | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [folders, setFolders] = useState("");
  const [tags, setTags] = useState("");
  const [prices, setPrices] = useState("{}");

  useEffect(() => {
    let active = true;
    void getPolicy()
      .then(({ policy: next, usage: stats }) => {
        if (!active) return;
        setPolicy(next);
        setUsage(stats);
        setFolders(next.excluded_cloud_folders.join(", "));
        setTags(next.excluded_cloud_tags.join(", "));
        setPrices(JSON.stringify(next.provider_prices_per_1k));
        setLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        setMessage("Policy settings are unavailable while Loom is offline.");
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(): Promise<void> {
    if (!loaded || busy) return;
    setBusy(true);
    setMessage("Saving…");
    try {
      const result = await savePolicy({
        ...policy,
        excluded_cloud_folders: csv(folders),
        excluded_cloud_tags: csv(tags),
        provider_prices_per_1k: parsePrices(prices),
      });
      setPolicy(result.policy);
      setUsage(result.usage);
      setMessage("Policy saved.");
    } catch (error) {
      setMessage(describeApiError(error, "Could not save policy."));
    } finally {
      setBusy(false);
    }
  }

  return {
    policy,
    setPolicy,
    usage,
    loaded,
    busy,
    message,
    folders,
    setFolders,
    tags,
    setTags,
    prices,
    setPrices,
    submit,
  };
}
