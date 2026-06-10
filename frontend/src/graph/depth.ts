import type Graph from "graphology";
import type { GraphTuning } from "./tuning";

/**
 * Faux-3D depth for the 2D Sigma canvas. Every node gets a deterministic
 * depth ``z`` in [0, 1): 0 = the focus plane (full size, full ink), 1 = the
 * far layer. Four cues sell the illusion together:
 *
 *  - size: deeper nodes render smaller (``depthSizeFactor``)
 *  - ink: deeper nodes fade toward the page background (``depthColorFor``)
 *  - edges: links recede with their endpoints' average depth (``makeEdgeFader``)
 *  - draw order: nearer nodes occlude deeper ones (``zIndex`` attr + Sigma's
 *    zIndex setting)
 *
 * Everything flows through node attributes and reducers — positions are never
 * touched. (Sigma 3's ``process()`` re-reads x/y from graph attributes and
 * discards reducer overrides, so a positional parallax cannot be rendered
 * through this pipeline; size/color/zIndex are respected.)
 */

/** Max node-size reduction at z = 1. */
export const DEPTH_SIZE_SHRINK = 0.38;
/** Max blend toward the page background at z = 1. */
export const DEPTH_INK_FADE = 0.5;
/** Max edge-alpha reduction at z = 1 (z averaged over both endpoints). */
export const DEPTH_EDGE_FADE = 0.55;

/** Deterministic FNV-1a hash of a node id, folded to [0, 1). */
export function hash01(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100_000) / 100_000;
}

/**
 * Depth for a node: scattered by id hash, biased forward by connectedness so
 * hubs anchor the focus plane and leaves recede. ``connections`` uses the
 * same 12-link cap as the size formula in ``buildGraph``.
 */
export function zForNode(id: string, connections: number): number {
  const hub = Math.min(Math.max(connections, 0), 12) / 12;
  return (0.2 + 0.8 * hash01(id)) * (1 - 0.6 * hub);
}

/** Node-size multiplier for a depth (1 at the focus plane). */
export function depthSizeFactor(z: number): number {
  return 1 - DEPTH_SIZE_SHRINK * z;
}

/** Size multiplier the overlays (travelers/lens) should apply so their node
 * masks track the rendered disk; 1 when depth is off. */
export function depthSizeFactorFor(tuning: GraphTuning, z: number): number {
  return tuning.depthEnabled ? depthSizeFactor(z) : 1;
}

/** The washed-toward-the-paper ink for a node at depth ``z`` — the single
 * blend formula shared by build, theme swap, and content sync. */
export function depthColorFor(base: string, bg: string, z: number): string {
  return mixToward(base, bg, DEPTH_INK_FADE * z);
}

/** Snapshot every node's ``z`` attribute (for the edge reducer's fade). */
export function collectNodeZ(graph: Graph): Map<string, number> {
  const zs = new Map<string, number>();
  graph.forEachNode((id, attrs) =>
    zs.set(id, (attrs["z"] as number | undefined) ?? 0),
  );
  return zs;
}

function parseHex(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  let hex = m[1]!;
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

/**
 * Blend ``color`` toward ``target`` by ``t`` (0 = color, 1 = target). Both
 * must be hex; returns ``color`` unchanged if either fails to parse, so an
 * exotic theme value degrades to "no fade" rather than a broken paint.
 */
export function mixToward(color: string, target: string, t: number): string {
  const a = parseHex(color);
  const b = parseHex(target);
  if (!a || !b) return color;
  const k = Math.max(0, Math.min(1, t));
  const ch = (i: number): string =>
    Math.round(a[i]! + (b[i]! - a[i]!) * k)
      .toString(16)
      .padStart(2, "0");
  return `#${ch(0)}${ch(1)}${ch(2)}`;
}

/**
 * Scale the alpha of an ``rgba(...)`` / ``rgb(...)`` / hex color string.
 * Returns the input unchanged when it can't be parsed.
 */
export function fadeAlpha(color: string, mul: number): string {
  const k = Math.max(0, Math.min(1, mul));
  const m =
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(
      color.trim(),
    );
  if (m) {
    const alpha = m[4] === undefined ? 1 : Number(m[4]);
    return `rgba(${m[1]},${m[2]},${m[3]},${+(alpha * k).toFixed(3)})`;
  }
  const hex = parseHex(color);
  if (hex) return `rgba(${hex[0]},${hex[1]},${hex[2]},${+k.toFixed(3)})`;
  return color;
}

/**
 * Memoizing edge-fade: alpha-scaled variants of a base color, quantized to
 * hundredths so a refresh doesn't allocate a new string per edge per frame.
 */
export function makeEdgeFader(): (base: string, fade: number) => string {
  const cache = new Map<string, string>();
  return (base, fade) => {
    const q = Math.round(Math.max(0, Math.min(1, fade)) * 100) / 100;
    const key = `${base}|${q}`;
    let out = cache.get(key);
    if (!out) {
      out = fadeAlpha(base, q);
      cache.set(key, out);
    }
    return out;
  };
}
