import type { NodeObject } from "react-force-graph-2d";

export const POLL_INTERVAL = 10_000;

export interface LoomNode {
  id: string;
  title: string;
  type: string;
  linkCount: number;
}

export interface LoomLink {
  source: string;
  target: string;
}

export interface GraphColors {
  bg: string;
  label: string;
  labelBright: string;
  edge: string;
  edgeHover: string;
  selected: string;
  dimmedNode: string;
  dimmedEdge: string;
  labelBg: string;
  nodeHex: Record<string, string>;
  fallback: string;
}

export function nodeRadius(n: NodeObject<LoomNode>): number {
  const count = n.linkCount ?? 0;
  return 4 + count * 1.5;
}

export function getLinkId(link: LoomLink): { src: string; tgt: string } {
  const src = typeof link.source === "object" ? (link.source as LoomNode).id : link.source;
  const tgt = typeof link.target === "object" ? (link.target as LoomNode).id : link.target;
  return { src, tgt };
}
