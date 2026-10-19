import type { PolicyUsage } from "@/api/policy";

/** Today's estimated token use per provider and captures per source. */
export function PolicyUsageCard({ usage }: { usage: PolicyUsage }) {
  const providers = Object.entries(usage.tokens_by_provider);
  const sources = Object.entries(usage.captures_by_source);
  return (
    <section
      aria-label="Provider usage"
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 text-sm"
    >
      <h2 className="font-medium text-foreground">Usage · {usage.day} UTC</h2>
      <p className="text-muted-foreground">
        <span className="font-mono">{usage.total_tokens.toLocaleString()}</span>{" "}
        estimated tokens
      </p>
      {providers.length > 0 && (
        <ul className="flex flex-col gap-1 text-secondary-foreground">
          {providers.map(([provider, count]) => (
            <li key={provider}>
              {provider}: {count.input_tokens ?? count.tokens} input ·{" "}
              {count.output_tokens ?? 0} output
              {usage.estimated_cost_by_provider?.[provider] !== undefined
                ? ` · ~$${usage.estimated_cost_by_provider[provider].toFixed(4)}`
                : " · price not configured"}
            </li>
          ))}
        </ul>
      )}
      {sources.length > 0 && (
        <ul className="flex flex-col gap-1 text-secondary-foreground">
          {sources.map(([source, count]) => (
            <li key={source}>
              {source}: {count} captures imported
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
