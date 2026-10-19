import type { MatchExplanation } from "./match";

/** Keyword / semantic chunk / graph proximity, each with its score. */
export function WhyItMatched({
  explanation,
}: {
  explanation: MatchExplanation;
}) {
  return (
    <section aria-labelledby="palette-why" className="flex flex-col gap-2">
      <h4
        id="palette-why"
        className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase"
      >
        Why it matched
      </h4>
      <dl className="flex flex-col gap-2.5">
        {explanation.rows.map((row) => (
          <div key={row.signal} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <dt className="text-secondary-foreground">{row.label}</dt>
              <dd className="font-mono text-muted-foreground tabular-nums">
                {row.score === null ? "—" : row.score.toFixed(2)}
              </dd>
            </div>
            <div
              aria-hidden="true"
              className="h-1 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${Math.round((row.score ?? 0) * 100)}%` }}
              />
            </div>
            <dd
              className="truncate text-xs text-muted-foreground"
              title={row.detail}
            >
              {row.detail}
            </dd>
          </div>
        ))}
      </dl>
      {explanation.source === "estimate" && (
        <p className="text-[11px] text-muted-foreground">
          Estimated in the browser: the search API doesn't report per-signal
          scores yet.
        </p>
      )}
    </section>
  );
}
