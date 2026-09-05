import { type ChangeEvent, type ReactNode, useEffect, useState } from "react";
import {
  type AutomationPolicy,
  type PolicyUsage,
  getPolicy,
  savePolicy,
} from "../../api/policy";

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

export function PolicySection(): ReactNode {
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

  const number =
    (field: "per_source_daily_capture_limit" | "daily_token_limit") =>
    (event: ChangeEvent<HTMLInputElement>) =>
      setPolicy((current) => ({
        ...current,
        [field]: Math.max(0, Number(event.target.value) || 0),
      }));

  async function submit(): Promise<void> {
    if (!loaded || busy) return;
    setBusy(true);
    setMessage("Saving…");
    try {
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
      const result = await savePolicy({
        ...policy,
        excluded_cloud_folders: csv(folders),
        excluded_cloud_tags: csv(tags),
        provider_prices_per_1k: parsed as Record<string, number>,
      });
      setPolicy(result.policy);
      setUsage(result.usage);
      setMessage("Policy saved.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save policy.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-panel">
      <div className="settings-kicker">Policy</div>
      <h1 className="settings-title">Automation &amp; privacy</h1>
      <p className="settings-copy">
        Set bounds for unattended imports and cloud provider use.
      </p>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={policy.paused}
          onChange={(event) =>
            setPolicy({ ...policy, paused: event.target.checked })
          }
        />
        Pause scheduled imports and processing
      </label>
      <label className="settings-field">
        Daily captures per source (0 is unlimited)
        <input
          type="number"
          min="0"
          value={policy.per_source_daily_capture_limit}
          onChange={number("per_source_daily_capture_limit")}
        />
      </label>
      <label className="settings-field">
        Daily estimated input-token limit (0 is unlimited)
        <input
          type="number"
          min="0"
          value={policy.daily_token_limit}
          onChange={number("daily_token_limit")}
        />
      </label>
      <label className="settings-field">
        Folders excluded from cloud calls
        <input
          value={folders}
          onChange={(event) => setFolders(event.target.value)}
          placeholder="private, people/medical"
        />
      </label>
      <label className="settings-field">
        Tags excluded from cloud calls
        <input
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder="private, confidential"
        />
      </label>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={policy.retain_raw_traces}
          onChange={(event) =>
            setPolicy({ ...policy, retain_raw_traces: event.target.checked })
          }
        />
        Retain raw prompts and responses in traces
      </label>
      <p className="settings-copy">
        Input allowances are checked before each provider attempt. Output tokens
        are counted afterward, so this is not a spending cap. Counts use a
        shared tokenizer and can differ from your provider bill. Raw retention
        affects new traces; existing traces keep their retention schedule.
      </p>
      <label className="settings-field">
        Optional blended USD price per 1,000 tokens by provider
        <textarea
          aria-label="Provider price estimates"
          value={prices}
          onChange={(event) => setPrices(event.target.value)}
          placeholder={'{"openai": 0.01}'}
        />
      </label>
      {usage && (
        <section aria-label="Provider usage">
          <h2>Usage · {usage.day} UTC</h2>
          <p>{usage.total_tokens.toLocaleString()} estimated tokens</p>
          {Object.entries(usage.tokens_by_provider).map(([provider, count]) => (
            <p key={provider}>
              {provider}: {count.input_tokens ?? count.tokens} input ·{" "}
              {count.output_tokens ?? 0} output
              {usage.estimated_cost_by_provider?.[provider] !== undefined
                ? ` · ~$${usage.estimated_cost_by_provider[provider].toFixed(4)}`
                : " · price not configured"}
            </p>
          ))}
          {Object.entries(usage.captures_by_source).map(([source, count]) => (
            <p key={source}>
              {source}: {count} captures imported
            </p>
          ))}
        </section>
      )}
      <button
        className="btn btn-md"
        type="button"
        disabled={!loaded || busy}
        onClick={() => void submit()}
      >
        {busy ? "Saving…" : "Save policy"}
      </button>
      {message && (
        <p className="settings-copy" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
