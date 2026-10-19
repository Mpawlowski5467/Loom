import { Lock } from "lucide-react";
import type { AgentModelEntry, AgentModelRecommendation } from "@/api/types";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "../kit/Field";
import { ModelCombobox } from "../ModelCombobox";
import { PROVIDERS } from "../providerModels";
import { RatingBadge } from "./RatingBadge";
import type { RowValue } from "./useAgentModels";

interface AgentModelRowProps {
  agent: AgentModelEntry;
  row: RowValue;
  recommendation: AgentModelRecommendation | undefined;
  modelOptions: string[];
  onProvider: (provider: string) => void;
  onModel: (model: string) => void;
  onUseRecommended: () => void;
}

/** One built-in agent: its provider and model, and the local recommendation. */
export function AgentModelRow({
  agent,
  row,
  recommendation,
  modelOptions,
  onProvider,
  onModel,
  onUseRecommended,
}: AgentModelRowProps) {
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-[minmax(8rem,11rem)_minmax(0,1fr)_minmax(0,1.3fr)] sm:items-start">
        <div className="flex min-w-0 items-start gap-2.5 sm:pt-6">
          <AgentAvatar actor={agent.id} size="md" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-1.5">
              <strong className="font-semibold text-foreground">
                {agent.name}
              </strong>
              <Lock
                className="size-3 shrink-0 text-muted-foreground"
                role="img"
                aria-label="System agent"
              />
            </span>
            <span className="text-xs text-muted-foreground">{agent.role}</span>
          </div>
        </div>
        {agent.uses_model ? (
          <>
            <Field label="Provider">
              <NativeSelect
                aria-label={`${agent.name} provider`}
                value={row.provider}
                onChange={(e) => onProvider(e.target.value)}
              >
                <option value="">Default</option>
                {PROVIDERS.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <ModelCombobox
              label="Model"
              value={row.chat_model}
              options={modelOptions}
              disabled={!row.provider}
              onChange={onModel}
            />
          </>
        ) : (
          <p className="font-mono text-xs text-muted-foreground sm:col-span-2 sm:self-center sm:pt-6">
            Deterministic checks · no model required
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs">
        {recommendation?.model ? (
          <>
            <span className="text-secondary-foreground">
              Recommended:{" "}
              <strong className="font-mono font-medium text-foreground">
                {recommendation.model}
              </strong>
            </span>
            {recommendation.rating && (
              <RatingBadge rating={recommendation.rating} />
            )}
            <Badge
              variant="outline"
              className="font-mono text-muted-foreground"
            >
              {recommendation.source} · {recommendation.confidence}
            </Badge>
            <span className="text-muted-foreground">
              {recommendation.reason}
            </span>
            <Button
              variant="outline"
              size="sm"
              type="button"
              className="ml-auto"
              onClick={onUseRecommended}
            >
              Use recommended
            </Button>
          </>
        ) : (
          <span className="text-muted-foreground">
            {recommendation?.reason ??
              "No compatible installed Ollama recommendation."}
          </span>
        )}
      </div>
    </li>
  );
}
