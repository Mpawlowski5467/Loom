import type { ReactNode } from "react";
import { Save, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsGroup } from "./kit/SettingsGroup";
import { StatusLine } from "./kit/StatusLine";
import { AgentModelRow } from "./models/AgentModelRow";
import { useAgentModels } from "./models/useAgentModels";

/** Per-agent chat provider/model overrides; saving rebinds agents immediately. */
export function AgentModelsCard(): ReactNode {
  const m = useAgentModels();
  const { data, status, saving } = m;
  return (
    <SettingsGroup
      title="Built-in agent models"
      description={
        <>
          Use hardware-aware local recommendations or set a manual override.
          Empty rows use the global default
          {data ? ` (${data.default_provider})` : ""}. Custom agents keep their
          model choice in Add/Edit Agent.
        </>
      }
    >
      {data && (
        <ul className="flex flex-col gap-2.5">
          {m.systemAgents.map((agent) => {
            const row = m.rows[agent.id] ?? { provider: "", chat_model: "" };
            return (
              <AgentModelRow
                key={agent.id}
                agent={agent}
                row={row}
                recommendation={m.recommendations[agent.id]}
                modelOptions={m.modelOptions(row.provider)}
                onProvider={(provider) => {
                  m.patchRow(agent.id, { provider });
                  m.ensureModels(provider);
                }}
                onModel={(value) => m.patchRow(agent.id, { chat_model: value })}
                onUseRecommended={() => m.stageRecommendation(agent.id)}
              />
            );
          })}
        </ul>
      )}
      {!data && !status && (
        <p className="text-sm text-muted-foreground">Loading agents…</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={!data || !m.hasRecommendations || saving}
          onClick={m.applyRecommendedSetup}
        >
          <Sparkles aria-hidden="true" />
          Apply recommended setup
        </Button>
        <Button
          size="sm"
          type="button"
          disabled={!data || !m.dirty || saving}
          onClick={() => void m.save()}
        >
          <Save aria-hidden="true" />
          {saving ? "Saving…" : "Save agent models"}
        </Button>
      </div>
      {status && <StatusLine tone={status.tone}>{status.text}</StatusLine>}
    </SettingsGroup>
  );
}
