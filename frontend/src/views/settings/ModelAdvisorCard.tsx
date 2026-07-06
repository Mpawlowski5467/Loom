import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { getRecommendations, runBenchmark } from "../../api/hardware";
import type {
  BenchmarkResponse,
  ModelRecommendation,
  RecommendationsResponse,
} from "../../api/types";

/** Local (Ollama) models rated against the hardware profile, with benchmarking. */
export function ModelAdvisorCard(): ReactNode {
  const [recs, setRecs] = useState<RecommendationsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Benchmarks hit the local model one at a time; the running model's name.
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, BenchmarkResponse>>({});

  useEffect(() => {
    let cancelled = false;
    void getRecommendations()
      .then((res) => {
        if (!cancelled) setRecs(res);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Recommendations failed",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const benchmark = async (model: string) => {
    setRunning(model);
    try {
      const res = await runBenchmark({ provider: "ollama", model });
      setResults((prev) => ({ ...prev, [model]: res }));
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        [model]: {
          ok: false,
          latency_ms: 0,
          chars: 0,
          chars_per_sec: 0,
          error: err instanceof Error ? err.message : "Benchmark failed",
        },
      }));
    } finally {
      setRunning(null);
    }
  };

  const profile = recs?.profile;
  return (
    <section>
      <h2 className="settings-subhead">Local models</h2>
      <p className="settings-copy settings-copy-tight">
        Installed Ollama models plus a pullable shortlist, rated against your
        {profile && profile.ram_gb > 0
          ? ` ${profile.ram_gb} GB of ${profile.unified_memory ? "unified memory" : "memory"}`
          : " hardware profile"}
        . Benchmarks run one short chat at a time.
      </p>
      {recs && recs.models.length === 0 && (
        <p className="settings-hint">No local models to rate.</p>
      )}
      {recs && recs.models.length > 0 && (
        <ul className="settings-model-list">
          {recs.models.map((model) => (
            <ModelRow
              key={model.name}
              model={model}
              running={running}
              result={results[model.name]}
              onBenchmark={() => void benchmark(model.name)}
            />
          ))}
        </ul>
      )}
      {!recs && !error && <p className="settings-hint">Rating models…</p>}
      {error && <div className="settings-inline-status">{error}</div>}
    </section>
  );
}

function ModelRow(props: {
  model: ModelRecommendation;
  running: string | null;
  result: BenchmarkResponse | undefined;
  onBenchmark: () => void;
}): ReactNode {
  const { model, running, result } = props;
  const isRunning = running === model.name;
  return (
    <li className="settings-model-row">
      <div className="settings-model-ident">
        <span className="settings-model-name">{model.name}</span>
        <span className="settings-model-meta">~{model.est_ram_gb} GB RAM</span>
      </div>
      <span className={`settings-rating-chip ${model.rating}`}>
        {model.rating}
      </span>
      {model.installed && <span className="settings-model-badge">installed</span>}
      {model.recommended_for.length > 0 && (
        <span className="settings-model-badge is-recommended">
          recommended · {model.recommended_for.join(", ")}
        </span>
      )}
      <div className="settings-model-actions">
        {result && (
          <span
            className={`settings-test-result ${result.ok ? "ok" : "fail"}`}
          >
            {result.ok
              ? `${result.latency_ms} ms · ${result.chars_per_sec} chars/s`
              : (result.error ?? "failed")}
          </span>
        )}
        {model.installed && (
          <button
            className="btn btn-md"
            type="button"
            disabled={running !== null}
            onClick={props.onBenchmark}
          >
            {isRunning ? "Running…" : "Benchmark"}
          </button>
        )}
      </div>
    </li>
  );
}
