import type { ReactNode } from "react";
import { useApp } from "../context/app-ctx";

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
          <span className="toast-icon" aria-hidden="true">
            {t.icon}
          </span>
          <span>
            {t.agent && <span className="agent-tag">{t.agent}</span>}
            {t.body}
          </span>
        </div>
      ))}
    </div>
  );
}
