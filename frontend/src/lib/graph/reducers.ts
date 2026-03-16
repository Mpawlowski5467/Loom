/**
 * Sigma node and edge reducers: filtering, hover dimming, selection,
 * pin indicators, and glow effects.
 */

import type Graph from "graphology";
import { NODE_COLORS_HEX } from "../constants";

const EDGE_COLOR = "rgba(148,163,184,0.12)";
const EDGE_COLOR_HEAVY = "rgba(167,139,250,0.2)";
const DIMMED_NODE = "rgba(148,163,184,0.06)";
const DIMMED_EDGE = "rgba(148,163,184,0.03)";
const HOVER_EDGE = "rgba(167,139,250,0.45)";
const SELECTED_RING_COLOR = "#f59e0b"; // amber

export const BASE_NODE_SIZE = 6;
export const SIZE_SCALE = 2.5;

export interface ReducerRefs {
  graph: React.MutableRefObject<Graph | null>;
  filterType: React.MutableRefObject<string>;
  hoveredNode: React.MutableRefObject<string | null>;
  selectedNode: React.MutableRefObject<string | null>;
  pinnedNodes: React.MutableRefObject<Set<string>>;
}

type NodeData = Record<string, unknown>;
type EdgeData = Record<string, unknown>;

/**
 * Create the nodeReducer function for Sigma.
 */
export function createNodeReducer(refs: ReducerRefs) {
  return (node: string, data: NodeData): NodeData => {
    const res = { ...data };
    const ft = refs.filterType.current;
    const hovered = refs.hoveredNode.current;
    const selected = refs.selectedNode.current;
    const g = refs.graph.current;

    // Filter by type
    if (ft !== "all" && data.noteType !== ft) {
      res.hidden = true;
      return res;
    }

    // Hover dimming — fade non-neighbors
    if (hovered && hovered !== node && node !== selected) {
      if (g && !g.neighbors(hovered).includes(node)) {
        res.color = DIMMED_NODE;
        res.label = null;
        res.zIndex = 0;
      }
    }

    // Hovered node: scale up, high z-index
    if (hovered === node) {
      res.highlighted = true;
      res.zIndex = 10;
      const baseSize = (data.baseSize as number) || (data.size as number);
      res.size = baseSize * 1.3;
    }

    // Selected node: ring effect (Sigma renders this as highlighted border)
    if (selected === node) {
      res.highlighted = true;
      res.zIndex = 9;
      res.borderColor = SELECTED_RING_COLOR;
      res.borderSize = 2;
      // Selected stays full opacity even when hovering others
      res.color = data.color || NODE_COLORS_HEX[(data.noteType as string)] || "#94a3b8";
    }

    // Pinned indicator
    if (refs.pinnedNodes.current.has(node)) {
      res.borderColor = "#94a3b8";
      res.borderSize = 1.5;
    }

    return res;
  };
}

/**
 * Create the edgeReducer function for Sigma.
 */
export function createEdgeReducer(refs: ReducerRefs) {
  return (edge: string, data: EdgeData): EdgeData => {
    const res = { ...data };
    const ft = refs.filterType.current;
    const g = refs.graph.current;
    const hovered = refs.hoveredNode.current;

    if (!g) return res;

    const source = g.source(edge);
    const target = g.target(edge);

    // Filter: hide edges to hidden nodes
    if (ft !== "all") {
      const sType = g.getNodeAttribute(source, "noteType");
      const tType = g.getNodeAttribute(target, "noteType");
      if (sType !== ft || tType !== ft) {
        res.hidden = true;
        return res;
      }
    }

    // Edge weight → thickness
    const weight = (g.getEdgeAttribute(edge, "weight") ?? 1) as number;
    res.size = Math.min(0.5 + weight * 0.8, 4);
    res.color = weight > 2 ? EDGE_COLOR_HEAVY : EDGE_COLOR;

    // Hover: dim non-connected edges, brighten connected
    if (hovered) {
      if (source !== hovered && target !== hovered) {
        res.color = DIMMED_EDGE;
        res.size = 0.3;
      } else {
        res.color = HOVER_EDGE;
        res.size = Math.max(res.size as number, 1.5);
      }
    }

    return res;
  };
}
