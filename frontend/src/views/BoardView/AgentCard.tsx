import type { AgentStatus } from "../../lib/api";
import styles from "./BoardView.module.css";
import { formatTime } from "./helpers";

interface AgentCardProps {
  agent: AgentStatus;
  initial: string;
  running: boolean;
  onRun: () => void;
}

export function AgentCard({ agent, initial, running, onRun }: AgentCardProps) {
  const statusLabel = running ? "Running" : "Idle";
  const statusClass = running ? styles.badgeRunning : styles.badgeIdle;

  return (
    <div className={styles.card}>
      <div className={styles.cardTop}>
        <span className={styles.cardInitial}>{initial}</span>
        <div className={styles.cardIdent}>
          <span className={styles.cardName}>{agent.name}</span>
          <span className={styles.cardRole}>{agent.role}</span>
        </div>
        <span className={statusClass}>{statusLabel}</span>
      </div>
      <p className={styles.cardDesc}>{agent.role}</p>
      <div className={styles.cardStats}>
        <span>Actions: {agent.action_count}</span>
        <span>Last: {agent.last_action ? formatTime(agent.last_action) : "never"}</span>
      </div>
      <div className={styles.cardBottom}>
        <button className={styles.runBtn} onClick={onRun} disabled={running}>
          {running ? "Running..." : "Run"}
        </button>
      </div>
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className={`${styles.card} ${styles.skeletonCard}`} aria-hidden="true">
      <div className={styles.cardTop}>
        <span className={`${styles.cardInitial} ${styles.skeletonBlock}`} />
        <div className={styles.cardIdent}>
          <span className={`${styles.skeletonLine} ${styles.skeletonLineWide}`} />
          <span className={`${styles.skeletonLine} ${styles.skeletonLineNarrow}`} />
        </div>
      </div>
      <span className={`${styles.skeletonLine} ${styles.skeletonLineFull}`} />
      <span className={`${styles.skeletonLine} ${styles.skeletonLineWide}`} />
      <div className={styles.cardBottom}>
        <span className={`${styles.skeletonLine} ${styles.skeletonLineButton}`} />
      </div>
    </div>
  );
}
