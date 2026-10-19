import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { getRecommendations, runBenchmark } from "@/api/hardware";
import type {
  BenchmarkResponse,
  ModelRecommendation,
  RecommendationsResponse,
} from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SettingsGroup } from "./kit/SettingsGroup";
import { StatusLine } from "./kit/StatusLine";
import { RatingBadge } from "./models/RatingBadge";
import { describeApiError } from "@/api/client";

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
          setError(describeApiError(err, "Recommendations failed"));
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
          error: describeApiError(err, "Benchmark failed"),
        },
      }));
    } finally {
      setRunning(null);
    }
  };

  const profile = recs?.profile;
  return (
    <SettingsGroup
      level={3}
      title="Local models"
      description={
        <>
          Installed Ollama models plus a pullable shortlist, rated against your
          {profile && profile.ram_gb > 0
            ? ` ${profile.ram_gb} GB of ${profile.unified_memory ? "unified memory" : "memory"}`
            : " hardware profile"}
          . Benchmarks run one short chat at a time.
        </>
      }
    >
      {recs && recs.models.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No local models to rate.
        </p>
      )}
      {recs && recs.models.length > 0 && (
        <ul className="flex flex-col gap-2">
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
      {!recs && !error && (
        <p className="text-sm text-muted-foreground">Rating models…</p>
      )}
      {error && <StatusLine tone="error">{error}</StatusLine>}
    </SettingsGroup>
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
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-card px-4 py-3 text-sm">
      <div className="flex min-w-0 flex-col gap-0.5 sm:min-w-40">
        <span className="font-mono break-all text-foreground">
          {model.name}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          ~{model.est_ram_gb} GB RAM
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <RatingBadge rating={model.rating} />
        {model.installed && (
          <Badge variant="outline" className="text-muted-foreground">
            installed
          </Badge>
        )}
        {model.recommended_for.length > 0 && (
          <Badge variant="outline" className="border-brand/40 text-brand">
            recommended · {model.recommended_for.join(", ")}
          </Badge>
        )}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-3">
        {result && (
          <span
            className={cn(
              "font-mono text-xs",
              result.ok ? "text-ok-foreground" : "text-danger-foreground",
            )}
          >
            {result.ok
              ? `${result.latency_ms} ms · ${result.chars_per_sec} chars/s`
              : (result.error ?? "failed")}
          </span>
        )}
        {model.installed && (
          <Button
            variant="outline"
            size="sm"
            type="button"
            disabled={running !== null}
            onClick={props.onBenchmark}
          >
            {isRunning ? "Running…" : "Benchmark"}
          </Button>
        )}
      </div>
    </li>
  );
}
