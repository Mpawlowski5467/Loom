import type { AgentStatus } from "../../lib/api";
import { AgentCard, SkeletonCard } from "./AgentCard";
import styles from "./BoardView.module.css";
import { getInitials } from "./helpers";

interface AgentTierProps {
  title: string;
  badgeLabel: string;
  badgeClass: string;
  agents: AgentStatus[];
  loading: boolean;
  skeletonCount: number;
  allAgentNames: string[];
  runningAgents: Set<string>;
  onRun: (name: string) => void;
}

export function AgentTier({
  title,
  badgeLabel,
  badgeClass,
  agents,
  loading,
  skeletonCount,
  allAgentNames,
  runningAgents,
  onRun,
}: AgentTierProps) {
  return (
    <section className={styles.tierSection}>
      <div className={styles.tierHeader}>
        <h2 className={styles.tierTitle}>{title}</h2>
        <span className={badgeClass}>{badgeLabel}</span>
      </div>
      <div className={styles.divider} />
      <div className={styles.agentGrid}>
        {loading
          ? Array.from({ length: skeletonCount }, (_, i) => (
              <SkeletonCard key={`skel-${title}-${i}`} />
            ))
          : agents.map((agent) => (
              <AgentCard
                key={agent.name}
                agent={agent}
                initial={getInitials(agent.name, allAgentNames)}
                running={runningAgents.has(agent.name)}
                onRun={() => onRun(agent.name)}
              />
            ))}
      </div>
    </section>
  );
}
