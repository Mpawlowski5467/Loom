import type Sigma from "sigma";

/**
 * DOM write helpers for the traveler overlay (travelers.ts). Each line keeps
 * a cache of the attribute strings it last wrote, so a frame only touches
 * attributes whose values changed.
 */

export interface LineCache {
  x1: string;
  y1: string;
  x2: string;
  y2: string;
  op: string;
  sw: string;
}

export function blankLineCache(): LineCache {
  return { x1: "", y1: "", x2: "", y2: "", op: "", sw: "" };
}

export function setLineAttr(
  el: SVGLineElement,
  cache: LineCache,
  x1: string,
  y1: string,
  x2: string,
  y2: string,
  op: string,
  sw: string,
): void {
  if (cache.x1 !== x1) {
    el.setAttribute("x1", x1);
    cache.x1 = x1;
  }
  if (cache.y1 !== y1) {
    el.setAttribute("y1", y1);
    cache.y1 = y1;
  }
  if (cache.x2 !== x2) {
    el.setAttribute("x2", x2);
    cache.x2 = x2;
  }
  if (cache.y2 !== y2) {
    el.setAttribute("y2", y2);
    cache.y2 = y2;
  }
  if (cache.op !== op) {
    el.setAttribute("opacity", op);
    cache.op = op;
  }
  if (cache.sw !== sw) {
    el.setAttribute("stroke-width", sw);
    cache.sw = sw;
  }
}

export function hideLine(el: SVGLineElement, cache: LineCache): void {
  if (cache.op !== "0") {
    el.setAttribute("opacity", "0");
    cache.op = "0";
  }
}

export interface CircleCache {
  cx: string;
  cy: string;
  r: string;
}

export function setCircleAttr(
  c: SVGCircleElement,
  cache: CircleCache,
  cx: string,
  cy: string,
  r: string,
): void {
  if (cache.cx !== cx) {
    c.setAttribute("cx", cx);
    cache.cx = cx;
  }
  if (cache.cy !== cy) {
    c.setAttribute("cy", cy);
    cache.cy = cy;
  }
  if (cache.r !== r) {
    c.setAttribute("r", r);
    cache.r = r;
  }
}

/**
 * Sigma 3's scaleSize() converts logical node sizes to viewport pixels at
 * the current camera ratio. Older versions don't expose it, so fall back to
 * its formula and the disk trim still tracks zoom.
 */
export function scaleSizeFor(sigma: Sigma): (size: number) => number {
  const scaled = sigma as unknown as { scaleSize?: (s: number) => number };
  return typeof scaled.scaleSize === "function"
    ? scaled.scaleSize.bind(sigma)
    : (s: number) => s / Math.sqrt(sigma.getCamera().ratio);
}
