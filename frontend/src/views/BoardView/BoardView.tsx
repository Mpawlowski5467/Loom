import { useState } from "react";
import styles from "./BoardView.module.css";

interface AgentDef {
  name: string;
  icon: string;
  role: string;
  description: string;
}

const LOOM_AGENTS: AgentDef[] = [
  {
    name: "Weaver",
    icon: "🧶",
    role: "Creator",
    description: "Creates new notes from captures and user requests using the read-before-write chain.",
  },
  {
    name: "Spider",
    icon: "🕷",
    role: "Linker",
    description: "Discovers and creates wikilink connections between related notes across the vault.",
  },
  {
    name: "Archivist",
    icon: "🗃",
    role: "Organizer",
    description: "Maintains folder structure, enforces naming conventions, and manages note lifecycle.",
  },
  {
    name: "Scribe",
    icon: "📜",
    role: "Summarizer",
    description: "Generates summaries, distills long notes, and maintains index files.",
  },
  {
    name: "Sentinel",
    icon: "🛡",
    role: "Validator",
    description: "Validates frontmatter schemas, checks broken links, and enforces vault policies.",
  },
];

const SHUTTLE_AGENTS: AgentDef[] = [
  {
    name: "Researcher",
    icon: "🔬",
    role: "Query & Synthesize",
    description: "Researches topics using external sources and synthesizes findings into captures.",
  },
  {
    name: "Standup",
    icon: "☀️",
    role: "Daily Recap",
    description: "Generates daily standup summaries from recent vault activity and changes.",
  },
];

type ShuttleTab = "Researcher" | "Standup";

export function BoardView() {
  const [councilInput, setCouncilInput] = useState("");
  const [shuttleTab, setShuttleTab] = useState<ShuttleTab>("Researcher");
  const [shuttleInput, setShuttleInput] = useState("");

  return (
    <div className={styles.board}>
      {/* Header */}
      <div className={styles.header}>
        <h1 className={styles.title}>Agent Board</h1>
        <p className={styles.subtitle}>
          {LOOM_AGENTS.length + SHUTTLE_AGENTS.length} agents configured
        </p>
      </div>

      {/* Loom Layer */}
      <section className={styles.tierSection}>
        <div className={styles.tierHeader}>
          <h2 className={styles.tierTitle}>Loom Layer</h2>
          <span className={styles.badgePurple}>System</span>
        </div>
        <div className={styles.divider} />
        <div className={styles.agentGrid}>
          {LOOM_AGENTS.map((agent) => (
            <AgentCard key={agent.name} agent={agent} />
          ))}
        </div>
      </section>

      {/* Loom Council Chat */}
      <section className={styles.chatSection}>
        <div className={styles.chatHeader}>
          <span>🕸 Loom Council</span>
        </div>
        <div className={styles.chatBody}>
          <p className={styles.chatEmpty}>
            Ask the Loom Council a question about your vault. All system agents
            will collaborate to answer.
          </p>
        </div>
        <div className={styles.chatInputRow}>
          <input
            className={styles.chatInput}
            type="text"
            placeholder="Ask the council..."
            value={councilInput}
            onChange={(e) => setCouncilInput(e.target.value)}
          />
          <button className={styles.chatSend}>Send</button>
        </div>
      </section>

      {/* Shuttle Layer */}
      <section className={styles.tierSection}>
        <div className={styles.tierHeader}>
          <h2 className={styles.tierTitle}>Shuttle Layer</h2>
          <span className={styles.badgeAmber}>Task</span>
        </div>
        <div className={styles.divider} />
        <div className={styles.agentGrid}>
          {SHUTTLE_AGENTS.map((agent) => (
            <AgentCard key={agent.name} agent={agent} />
          ))}
        </div>
      </section>

      {/* Shuttle Agent Chat */}
      <section className={styles.chatSection}>
        <div className={styles.chatHeader}>
          <div className={styles.chatTabs}>
            {SHUTTLE_AGENTS.map((agent) => (
              <button
                key={agent.name}
                className={`${styles.chatTab} ${shuttleTab === agent.name ? styles.chatTabActive : ""}`}
                onClick={() => setShuttleTab(agent.name as ShuttleTab)}
              >
                {agent.icon} {agent.name}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.chatBody}>
          <p className={styles.chatEmpty}>
            Chat with {shuttleTab} directly. Messages and results will appear
            here.
          </p>
        </div>
        <div className={styles.chatInputRow}>
          <input
            className={styles.chatInput}
            type="text"
            placeholder={`Ask ${shuttleTab}...`}
            value={shuttleInput}
            onChange={(e) => setShuttleInput(e.target.value)}
          />
          <button className={styles.chatSend}>Send</button>
        </div>
      </section>

      {/* Activity Log */}
      <section className={styles.activitySection}>
        <h2 className={styles.activityTitle}>Recent Activity</h2>
        <div className={styles.activityTable}>
          <div className={styles.activityHeader}>
            <span>Time</span>
            <span>Agent</span>
            <span>Action</span>
            <span>Status</span>
          </div>
          <div className={styles.activityEmpty}>No agent activity yet</div>
        </div>
      </section>
    </div>
  );
}

/* -- Agent Card sub-component ---------------------------------------------- */

function AgentCard({ agent }: { agent: AgentDef }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardTop}>
        <span className={styles.cardIcon}>{agent.icon}</span>
        <div className={styles.cardIdent}>
          <span className={styles.cardName}>{agent.name}</span>
          <span className={styles.cardRole}>{agent.role}</span>
        </div>
        <span className={styles.badgeIdle}>Idle</span>
      </div>
      <p className={styles.cardDesc}>{agent.description}</p>
      <div className={styles.cardStats}>
        <span>Actions: 0</span>
        <span>Notes: 0</span>
        <span>Links: 0</span>
      </div>
      <div className={styles.cardRecent}>
        <span className={styles.cardRecentLabel}>Recent</span>
        <span className={styles.cardRecentEmpty}>No recent actions</span>
      </div>
    </div>
  );
}
