import type { IndexStats } from "@/api/diagnostics";
import { SettingsCard } from "../kit/SettingsCard";
import { SettingsGroup } from "../kit/SettingsGroup";
import { InfoGrid, InfoRow } from "./InfoGrid";

/** Vector index size, or a hint to configure embeddings when it's empty. */
export function IndexStatsGroup({ stats }: { stats: IndexStats | null }) {
  const types = Object.entries(stats?.type_breakdown ?? {}).sort(
    (a, b) => b[1] - a[1],
  );
  return (
    <SettingsGroup title="Vector index">
      {stats && !stats.ready ? (
        <p className="text-sm text-muted-foreground">
          No vector index yet. Configure an embed provider and reindex (Settings
          → Models &amp; providers) so semantic search has data.
          {stats.unindexed_count > 0 &&
            ` ${stats.unindexed_count} note(s) await indexing.`}
        </p>
      ) : (
        <>
          <InfoGrid>
            <InfoRow
              label="Chunks"
              value={stats?.total_chunks.toString() ?? "…"}
              mono
            />
            <InfoRow
              label="Notes indexed"
              value={stats?.distinct_notes.toString() ?? "…"}
              mono
            />
            <InfoRow
              label="Unindexed"
              value={stats?.unindexed_count.toString() ?? "…"}
              mono
            />
            <InfoRow
              label="Avg chunks / note"
              value={stats?.avg_chunks_per_note.toFixed(1) ?? "…"}
              mono
            />
          </InfoGrid>
          {types.length > 0 && (
            <SettingsCard className="gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Chunks by type
              </span>
              <ul className="flex flex-col gap-1.5">
                {types.map(([type, count]) => (
                  <li key={type} className="flex items-center gap-2">
                    <span className="text-secondary-foreground capitalize">
                      {type}
                    </span>
                    <span className="ml-auto font-mono text-xs text-muted-foreground">
                      {count}
                    </span>
                  </li>
                ))}
              </ul>
            </SettingsCard>
          )}
        </>
      )}
    </SettingsGroup>
  );
}
