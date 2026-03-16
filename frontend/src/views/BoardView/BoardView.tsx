import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../../lib/context/useApp";
import {
  fetchAgents,
  fetchChangelog,
  runAgent,
  sendChatMessage,
  fetchChatHistory,
  type AgentStatus,
  type ChatMessage,
} from "../../lib/api";
import styles from "./BoardView.module.css";

const AGENT_INITIALS: Record<string, string> = {
  weaver: "W",
  spider: "Sp",
  archivist: "A",
  scribe: "Sc",
  sentinel: "Se",
  researcher: "R",
  standup: "St",
};

const AGENT_DESCS: Record<string, string> = {
  weaver: "Creates new notes from captures and user requests.",
  spider: "Discovers and creates wikilink connections between notes.",
  archivist: "Audits notes for quality, broken links, and staleness.",
  scribe: "Generates summaries, folder indexes, and daily logs.",
  sentinel: "Validates actions against vault rules and schemas.",
  researcher: "Researches topics and synthesizes findings.",
  standup: "Generates daily standup recaps from vault activity.",
};

const LOOM_NAMES = new Set(["weaver", "spider", "archivist", "scribe", "sentinel"]);

interface ActivityEntry {
  time: string;
  agent: string;
  action: string;
  details: string;
}

type ShuttleTab = "researcher" | "standup";

const POLL_MS = 5_000;

export function BoardView() {
  const { addToast } = useApp();
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [runningAgents, setRunningAgents] = useState<Set<string>>(new Set());

  // Chat state
  const [councilInput, setCouncilInput] = useState("");
  const [councilMessages, setCouncilMessages] = useState<ChatMessage[]>([]);
  const [councilSending, setCouncilSending] = useState(false);

  const [shuttleTab, setShuttleTab] = useState<ShuttleTab>("researcher");
  const [shuttleInput, setShuttleInput] = useState("");
  const [shuttleMessages, setShuttleMessages] = useState<Record<string, ChatMessage[]>>({
    researcher: [],
    standup: [],
  });
  const [shuttleSending, setShuttleSending] = useState(false);

  const lastSeenCountRef = useRef<Record<string, number>>({});
  const mountedRef = useRef(true);

  // Fetch agents + changelog
  const poll = useCallback(async () => {
    try {
      const agentList = await fetchAgents();
      if (!mountedRef.current) return;
      setAgents(agentList);

      // Check for new actions and fire toasts
      for (const a of agentList) {
        const prev = lastSeenCountRef.current[a.name] ?? a.action_count;
        if (a.action_count > prev) {
          const icon = AGENT_INITIALS[a.name] || "";
          addToast(`${icon} ${a.name} completed an action`, "info");
        }
        lastSeenCountRef.current[a.name] = a.action_count;
      }
    } catch {
      // silent
    }

    // Fetch recent activity from all agent changelogs
    try {
      const entries: ActivityEntry[] = [];
      const agentNames = [
        "weaver",
        "spider",
        "archivist",
        "scribe",
        "sentinel",
        "researcher",
        "standup",
      ];
      const results = await Promise.allSettled(agentNames.map((name) => fetchChangelog(name)));

      for (const r of results) {
        if (r.status === "fulfilled" && r.value.content) {
          const parsed = parseChangelogEntries(r.value.agent, r.value.content);
          entries.push(...parsed);
        }
      }

      entries.sort((a, b) => b.time.localeCompare(a.time));
      if (mountedRef.current) setActivity(entries.slice(0, 20));
    } catch {
      // silent
    }
  }, [addToast]);

  useEffect(() => {
    mountedRef.current = true;
    // Set initial counts so we don't toast on first load
    fetchAgents()
      .then((list) => {
        for (const a of list) lastSeenCountRef.current[a.name] = a.action_count;
        setAgents(list);
      })
      .catch(() => {});
    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [poll]);

  // Load chat history on mount
  useEffect(() => {
    fetchChatHistory("_council", 20)
      .then((r) => setCouncilMessages(r.messages))
      .catch(() => {});
    fetchChatHistory("researcher", 20)
      .then((r) => setShuttleMessages((prev) => ({ ...prev, researcher: r.messages })))
      .catch(() => {});
    fetchChatHistory("standup", 20)
      .then((r) => setShuttleMessages((prev) => ({ ...prev, standup: r.messages })))
      .catch(() => {});
  }, []);

  const handleRunAgent = async (name: string) => {
    setRunningAgents((s) => new Set(s).add(name));
    try {
      await runAgent(name);
      addToast(`${AGENT_INITIALS[name] || ""} ${name} run completed`, "success");
      poll();
    } catch {
      addToast(`${name} run failed`, "danger");
    } finally {
      setRunningAgents((s) => {
        const next = new Set(s);
        next.delete(name);
        return next;
      });
    }
  };

  const handleCouncilSend = async () => {
    if (!councilInput.trim() || councilSending) return;
    const msg = councilInput.trim();
    setCouncilInput("");
    setCouncilSending(true);
    try {
      const resp = await sendChatMessage(msg, "_council");
      setCouncilMessages((prev) => [...prev, resp.user_message, resp.assistant_message]);
    } catch {
      addToast("Council message failed", "danger");
    } finally {
      setCouncilSending(false);
    }
  };

  const handleShuttleSend = async () => {
    if (!shuttleInput.trim() || shuttleSending) return;
    const msg = shuttleInput.trim();
    setShuttleInput("");
    setShuttleSending(true);
    try {
      const resp = await sendChatMessage(msg, shuttleTab);
      setShuttleMessages((prev) => ({
        ...prev,
        [shuttleTab]: [...(prev[shuttleTab] || []), resp.user_message, resp.assistant_message],
      }));
    } catch {
      addToast(`${shuttleTab} message failed`, "danger");
    } finally {
      setShuttleSending(false);
    }
  };

  const loomAgents = agents.filter((a) => LOOM_NAMES.has(a.name));
  const shuttleAgents = agents.filter((a) => !LOOM_NAMES.has(a.name));

  return (
    <div className={styles.board}>
      <div className={styles.header}>
        <h1 className={styles.title}>Agent Board</h1>
        <p className={styles.subtitle}>{agents.length} agents configured</p>
      </div>

      {/* Loom Layer */}
      <section className={styles.tierSection}>
        <div className={styles.tierHeader}>
          <h2 className={styles.tierTitle}>Loom Layer</h2>
          <span className={styles.badgePurple}>System</span>
        </div>
        <div className={styles.divider} />
        <div className={styles.agentGrid}>
          {loomAgents.map((agent) => (
            <AgentCard
              key={agent.name}
              agent={agent}
              running={runningAgents.has(agent.name)}
              onRun={() => handleRunAgent(agent.name)}
            />
          ))}
        </div>
      </section>

      {/* Council Chat */}
      <section className={styles.chatSection}>
        <div className={styles.chatHeader}>
          <span>Loom Council</span>
        </div>
        <div className={styles.chatBody}>
          {councilMessages.length === 0 ? (
            <p className={styles.chatEmpty}>Ask the Loom Council a question about your vault.</p>
          ) : (
            <div className={styles.chatMessages}>
              {councilMessages.map((m, i) => (
                <div
                  key={i}
                  className={`${styles.chatMsg} ${m.role === "user" ? styles.chatMsgUser : styles.chatMsgAgent}`}
                >
                  <span className={styles.chatMsgRole}>
                    {m.role === "user" ? "You" : "Council"}
                  </span>
                  <span className={styles.chatMsgText}>{m.content}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className={styles.chatInputRow}>
          <input
            className={styles.chatInput}
            type="text"
            placeholder="Ask the council..."
            value={councilInput}
            onChange={(e) => setCouncilInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCouncilSend()}
            disabled={councilSending}
          />
          <button className={styles.chatSend} onClick={handleCouncilSend} disabled={councilSending}>
            {councilSending ? "..." : "Send"}
          </button>
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
          {shuttleAgents.map((agent) => (
            <AgentCard
              key={agent.name}
              agent={agent}
              running={runningAgents.has(agent.name)}
              onRun={() => handleRunAgent(agent.name)}
            />
          ))}
        </div>
      </section>

      {/* Shuttle Chat */}
      <section className={styles.chatSection}>
        <div className={styles.chatHeader}>
          <div className={styles.chatTabs}>
            {(["researcher", "standup"] as const).map((name) => (
              <button
                key={name}
                className={`${styles.chatTab} ${shuttleTab === name ? styles.chatTabActive : ""}`}
                onClick={() => setShuttleTab(name)}
              >
                {AGENT_INITIALS[name]} {name}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.chatBody}>
          {(shuttleMessages[shuttleTab] || []).length === 0 ? (
            <p className={styles.chatEmpty}>Chat with {shuttleTab} directly.</p>
          ) : (
            <div className={styles.chatMessages}>
              {(shuttleMessages[shuttleTab] || []).map((m, i) => (
                <div
                  key={i}
                  className={`${styles.chatMsg} ${m.role === "user" ? styles.chatMsgUser : styles.chatMsgAgent}`}
                >
                  <span className={styles.chatMsgRole}>
                    {m.role === "user" ? "You" : shuttleTab}
                  </span>
                  <span className={styles.chatMsgText}>{m.content}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className={styles.chatInputRow}>
          <input
            className={styles.chatInput}
            type="text"
            placeholder={`Ask ${shuttleTab}...`}
            value={shuttleInput}
            onChange={(e) => setShuttleInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleShuttleSend()}
            disabled={shuttleSending}
          />
          <button className={styles.chatSend} onClick={handleShuttleSend} disabled={shuttleSending}>
            {shuttleSending ? "..." : "Send"}
          </button>
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
          {activity.length === 0 ? (
            <div className={styles.activityEmpty}>No agent activity yet</div>
          ) : (
            activity.map((entry, i) => (
              <div key={i} className={styles.activityRow}>
                <span className={styles.activityTime}>{formatTime(entry.time)}</span>
                <span className={styles.activityAgent}>{entry.agent}</span>
                <span className={styles.activityAction}>{entry.details || entry.action}</span>
                <span className={styles.activityStatus}>
                  <span className={styles.statusDot} />
                  done
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

/* -- Agent Card --------------------------------------------------------------- */

function AgentCard({
  agent,
  running,
  onRun,
}: {
  agent: AgentStatus;
  running: boolean;
  onRun: () => void;
}) {
  const icon = AGENT_INITIALS[agent.name] || "?";
  const desc = AGENT_DESCS[agent.name] || agent.role;

  const statusLabel = running ? "Running" : "Idle";
  const statusClass = running ? styles.badgeRunning : styles.badgeIdle;

  return (
    <div className={styles.card}>
      <div className={styles.cardTop}>
        <span className={styles.cardInitial}>{icon}</span>
        <div className={styles.cardIdent}>
          <span className={styles.cardName}>{agent.name}</span>
          <span className={styles.cardRole}>{agent.role}</span>
        </div>
        <span className={statusClass}>{statusLabel}</span>
      </div>
      <p className={styles.cardDesc}>{desc}</p>
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

/* -- Helpers ------------------------------------------------------------------ */

function formatTime(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function parseChangelogEntries(agent: string, content: string): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  const blocks = content.split(/^## /m).filter(Boolean);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    const timeLine = lines[0]?.trim() || "";
    let action = "";
    let details = "";

    for (const line of lines) {
      if (line.startsWith("- **Action:**")) action = line.replace("- **Action:**", "").trim();
      if (line.startsWith("- **Details:**")) details = line.replace("- **Details:**", "").trim();
    }

    if (timeLine && action) {
      entries.push({ time: timeLine, agent, action, details: details || action });
    }
  }

  return entries;
}
