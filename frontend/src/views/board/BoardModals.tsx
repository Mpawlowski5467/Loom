import type { AgentRegistryRecord } from "@/api/agentsRegistry";
import { deleteCustomAgent } from "@/api/agentsRegistry";
import { ConfirmModal } from "@/components/ConfirmModal";
import { useApp } from "@/context/app-ctx";
import type { Agent } from "@/data/types";
import { AddAgentModal } from "./AddAgentModal";
import { AgentDetailModal } from "./AgentDetailModal";
import { agentDisplayName } from "./boardHelpers";
import type { AgentBoardState } from "./boardStats";
import { ResearcherWorkspace } from "./ResearcherWorkspace";
import { StandupWorkspace } from "./StandupWorkspace";

export type BoardModal =
  | { kind: "detail"; id: string }
  | { kind: "add" }
  | { kind: "edit"; record: AgentRegistryRecord }
  | { kind: "delete"; agent: Agent }
  | { kind: "researcher" }
  | { kind: "standup" }
  | null;

interface BoardModalsProps {
  modal: BoardModal;
  setModal: (modal: BoardModal) => void;
  agents: readonly Agent[];
  customIds: ReadonlySet<string>;
  stateOf: (agent: Agent) => AgentBoardState;
  isRunnable: (agent: Agent) => boolean;
  running: ReadonlySet<string>;
  onRun: (agent: Agent) => void;
  onEdit: (agent: Agent) => void;
}

/** Whichever Board dialog is open: details, builder, delete or a workspace. */
export function BoardModals(p: BoardModalsProps) {
  const { refreshCustomAgents, pushToast } = useApp();
  const close = () => p.setModal(null);
  const { modal } = p;
  if (!modal) return null;
  switch (modal.kind) {
    case "detail": {
      const agent = p.agents.find((a) => a.id === modal.id);
      if (!agent) return null;
      const isCustom = p.customIds.has(agent.id);
      return (
        <AgentDetailModal
          agent={agent}
          state={p.stateOf(agent)}
          isCustom={isCustom}
          runnable={p.isRunnable(agent)}
          running={p.running.has(agent.id)}
          onRun={() => p.onRun(agent)}
          onEdit={() => p.onEdit(agent)}
          onDelete={() => p.setModal({ kind: "delete", agent })}
          onClose={close}
        />
      );
    }
    case "add":
    case "edit":
      return (
        <AddAgentModal
          existing={modal.kind === "edit" ? modal.record : undefined}
          onClose={close}
          onSaved={async () => {
            await refreshCustomAgents();
            close();
          }}
        />
      );
    case "delete":
      return (
        <ConfirmModal
          title={`Delete custom agent "${agentDisplayName(modal.agent)}"?`}
          body="This removes the agent and its registry entry. This can't be undone."
          confirmLabel="Delete"
          destructive
          onConfirm={async () => {
            await deleteCustomAgent(modal.agent.id);
            await refreshCustomAgents();
            pushToast({
              icon: "✓",
              agent: "archivist",
              body: `Deleted agent ${agentDisplayName(modal.agent)}`,
            });
          }}
          onClose={close}
        />
      );
    case "researcher":
      return <ResearcherWorkspace onClose={close} />;
    case "standup":
      return <StandupWorkspace onClose={close} />;
  }
}
