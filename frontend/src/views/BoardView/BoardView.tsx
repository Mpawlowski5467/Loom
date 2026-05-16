import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AgentStatus,
  type ChatMessage,
  fetchAgents,
  fetchChangelog,
  fetchChatHistory,
  runAgent,
  sendChatMessage,
} from "../../lib/api";
import { useApp } from "../../lib/context/useApp";
import { ActivityLog } from "./ActivityLog";
import { AgentTier } from "./AgentTier";
import styles from "./BoardView.module.css";
import { CouncilChat } from "./CouncilChat";
import { getInitials, parseChangelogEntries } from "./helpers";
import { ShuttleChat } from "./ShuttleChat";
import {
  ALL_AGENT_NAMES,
  type ActivityEntry,
  LOOM_NAMES,
  POLL_MS,
  SKELETON_LOOM_COUNT,
  SKELETON_SHUTTLE_COUNT,
  type ShuttleTab,
} from "./types";

export function BoardView() {
  const { addToast } = useApp();
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [runningAgents, setRunningAgents] = useState<Set<string>>(new Set());

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

  const poll = useCallback(async () => {
    try {
      const agentList = await fetchAgents();
      if (!mountedRef.current) return;
      setAgents(agentList);
      setAgentsLoading(false);

      const names = agentList.map((a) => a.name);
      for (const a of agentList) {
        const prev = lastSeenCountRef.current[a.name] ?? a.action_count;
        if (a.action_count > prev) {
          const icon = getInitials(a.name, names);
          addToast(`${icon} ${a.name} completed an action`, "info");
        }
        lastSeenCountRef.current[a.name] = a.action_count;
      }
    } catch {
      if (mountedRef.current) setAgentsLoading(false);
    }

    try {
      const entries: ActivityEntry[] = [];
      const results = await Promise.allSettled(
        ALL_AGENT_NAMES.map((name) => fetchChangelog(name)),
      );

      for (const r of results) {
        if (r.status === "fulfilled" && r.value.content) {
          entries.push(...parseChangelogEntries(r.value.agent, r.value.content));
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
    fetchAgents()
      .then((list) => {
        if (!mountedRef.current) return;
        for (const a of list) lastSeenCountRef.current[a.name] = a.action_count;
        setAgents(list);
        setAgentsLoading(false);
      })
      .catch(() => {
        if (mountedRef.current) setAgentsLoading(false);
      });
    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [poll]);

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
      const icon = getInitials(
        name,
        agents.map((a) => a.name),
      );
      addToast(`${icon} ${name} run completed`, "success");
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
  const allAgentNames = agents.map((a) => a.name);

  return (
    <div className={styles.board}>
      <div className={styles.header}>
        <h1 className={styles.title}>Agent Board</h1>
        <p className={styles.subtitle}>
          {agentsLoading ? "Loading agents..." : `${agents.length} agents configured`}
        </p>
      </div>

      <AgentTier
        title="Loom Layer"
        badgeLabel="System"
        badgeClass={styles.badgePurple}
        agents={loomAgents}
        loading={agentsLoading}
        skeletonCount={SKELETON_LOOM_COUNT}
        allAgentNames={allAgentNames}
        runningAgents={runningAgents}
        onRun={handleRunAgent}
      />

      <CouncilChat
        messages={councilMessages}
        input={councilInput}
        sending={councilSending}
        onInputChange={setCouncilInput}
        onSend={handleCouncilSend}
      />

      <AgentTier
        title="Shuttle Layer"
        badgeLabel="Task"
        badgeClass={styles.badgeAmber}
        agents={shuttleAgents}
        loading={agentsLoading}
        skeletonCount={SKELETON_SHUTTLE_COUNT}
        allAgentNames={allAgentNames}
        runningAgents={runningAgents}
        onRun={handleRunAgent}
      />

      <ShuttleChat
        tab={shuttleTab}
        messages={shuttleMessages}
        input={shuttleInput}
        sending={shuttleSending}
        allAgentNames={allAgentNames}
        onTabChange={setShuttleTab}
        onInputChange={setShuttleInput}
        onSend={handleShuttleSend}
      />

      <ActivityLog activity={activity} />
    </div>
  );
}
