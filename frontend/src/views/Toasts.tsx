import type { ReactNode } from "react";
import { useApp } from "../context/app-ctx";
import { AgentBlob } from "../components/primitives/AgentBlob";

export function Toasts(): ReactNode {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="toast-region" aria-live="polite" aria-label="Notifications">
      {toasts.map((t) => (
        // A real <button> so keyboard users can dismiss (Enter/Space) — the
        // parent region's aria-live still announces each toast on arrival.
        <button
          key={t.id}
          type="button"
          className="toast"
          aria-label="Dismiss notification"
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
        </button>
      ))}
    </div>
  );
}
