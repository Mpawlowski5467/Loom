import type { VaultStats } from "./threadModel";

const ITEMS: readonly [keyof VaultStats, string][] = [
  ["notes", "Notes"],
  ["links", "Links"],
  ["superseded", "Superseded"],
  ["undone", "Undone by you"],
];

/** Notes, links, superseded notes and agent actions you undid this week. */
export function VaultStatsCard({ stats }: { stats: VaultStats }) {
  return (
    <section
      aria-labelledby="vault-stats-title"
      className="flex flex-col gap-3"
    >
      <h2
        id="vault-stats-title"
        className="text-sm font-medium text-foreground"
      >
        Vault
      </h2>
      <dl className="grid grid-cols-2 gap-2">
        {ITEMS.map(([key, label]) => (
          <div
            key={key}
            className="flex flex-col gap-0.5 rounded-lg border border-border bg-card px-3 py-2.5"
          >
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="font-mono text-lg font-semibold text-foreground tabular-nums">
              {stats[key].toLocaleString()}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        Undone counts agent actions you reverted this week.
      </p>
    </section>
  );
}
