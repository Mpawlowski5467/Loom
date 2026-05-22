import type { ReactNode } from "react";
import { useApp } from "../context/app-ctx";
import { AgentBlob } from "../components/primitives/AgentBlob";

export function Toasts(): ReactNode {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="toast-region" aria-live="polite" aria-label="Notifications">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast"
          role="status"
          onClick={() => dismissToast(t.id)}
        >
          {t.agent ? (
            <AgentBlob agent={t.agent} state="running" size={22} />
          ) : (
            <span className="toast-icon" aria-hidden="true">
              {t.icon}
            </span>
          )}
          <span>
            {t.agent && <span className="agent-tag">{t.agent}</span>}
            {t.body}
          </span>
        </div>
      ))}
    </div>
  );
}
