import type { ReactNode } from "react";

interface Props {
  title: string;
  onClose?: () => void;
  secondary?: boolean;
  editing?: boolean;
  children: ReactNode;
}

export function Sidebar({
  title,
  onClose,
  secondary,
  editing,
  children,
}: Props): ReactNode {
  return (
    <aside
      className={`sidebar ${secondary ? "secondary" : ""} ${editing ? "editing" : ""}`}
    >
      <div className="sidebar-h">
        <div className="sidebar-h-title">{title}</div>
        {onClose && (
          <button
            className="icon-btn"
            onClick={onClose}
            aria-label={`Close ${title}`}
          >
            ×
          </button>
        )}
      </div>
      <div className="sidebar-content">{children}</div>
    </aside>
  );
}
