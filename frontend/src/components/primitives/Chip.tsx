import type { ReactNode } from "react";
import type { NodeType } from "../../data/types";

interface ChipProps {
  type?: NodeType;
  children: ReactNode;
  className?: string;
}

export function Chip({ type, children, className }: ChipProps): ReactNode {
  const classes = ["chip", type && "chip-type", className].filter(Boolean).join(" ");
  return (
    <span className={classes} data-type={type}>
      {children}
    </span>
  );
}
