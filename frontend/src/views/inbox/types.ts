import type { NodeType } from "../../data/types";

export interface CardLink {
  key: string;
  title: string;
  decision?: string;
}

/** Normalised shape the suggestion card renders, from demo seed OR a preview. */
export interface CardData {
  type: NodeType;
  destFolder: string;
  title: string;
  tags: string[];
  links: CardLink[];
}

/** Backend note types use ``person``; the frontend NodeType is ``people``. */
export function toNodeType(t: string): NodeType {
  return (t === "person" ? "people" : t) as NodeType;
}
