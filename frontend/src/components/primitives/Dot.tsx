import type { ReactNode } from "react";
import type { NodeType } from "../../data/types";

interface Props {
  type: NodeType;
  className?: string;
}

const cls: Record<NodeType, string> = {
  project: "dot-project",
  topic: "dot-topic",
  people: "dot-people",
  daily: "dot-daily",
  capture: "dot-capture",
  custom: "dot-custom",
};

export function Dot({ type, className }: Props): ReactNode {
  return <span className={`dot ${cls[type]} ${className ?? ""}`.trim()} />;
}
