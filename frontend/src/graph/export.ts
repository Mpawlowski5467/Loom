import type Graph from "graphology";
import type Sigma from "sigma";
import { DEPTH_EDGE_FADE, depthSizeFactor, fadeAlpha } from "./depth";
import { isGraphNodeVisible } from "./filtering";

type FilePart = Blob | string;

function triggerDownload(part: FilePart, filename: string, mime: string): void {
  const blob = part instanceof Blob ? part : new Blob([part], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

export async function exportGraphPng(sigma: Sigma): Promise<void> {
  // Sigma 3 composites multiple WebGL canvases (nodes, edges, labels) into the
  // container DOM. To get a single PNG, blit each canvas onto a temporary 2D
  // canvas at viewport size, then toBlob.
  const container = sigma.getContainer();
  const w = container.clientWidth;
  const h = container.clientHeight;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  const bg = getComputedStyle(container).backgroundColor || "#f5f1e8";
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const canvases = container.querySelectorAll("canvas");
  canvases.forEach((c) => {
    ctx.drawImage(c, 0, 0, w, h);
  });

  await new Promise<void>((resolve, reject) => {
    out.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to create PNG blob"));
        return;
      }
      triggerDownload(blob, `loom-graph-${timestamp()}.png`, "image/png");
      resolve();
    }, "image/png");
  });
}

export function exportGraphSvg(
  sigma: Sigma,
  graph: Graph,
  opts?: { depth?: boolean },
): void {
  const svg = buildGraphSvg(sigma, graph, opts);
  triggerDownload(svg, `loom-graph-${timestamp()}.svg`, "image/svg+xml");
}

/** Build an SVG for the current visible graph without triggering a download. */
export function buildGraphSvg(
  sigma: Sigma,
  graph: Graph,
  opts?: { depth?: boolean },
): string {
  // Sigma renders via WebGL, not SVG. Build a faithful SVG from graph
  // attributes + the live camera so the export matches the on-screen view —
  // including the depth styling (size shrink / ink wash / edge fade), which
  // lives in the reducers, not the attributes.
  const depth = opts?.depth ?? false;
  const zOf = (id: string): number =>
    depth ? ((graph.getNodeAttribute(id, "z") as number | undefined) ?? 0) : 0;
  const container = sigma.getContainer();
  const w = container.clientWidth;
  const h = container.clientHeight;
  const bg = getComputedStyle(container).backgroundColor || "#f5f1e8";
  const labelFont = String(
    sigma.getSetting("labelFont") ?? "Inter, system-ui, sans-serif",
  );
  const labelColor =
    typeof sigma.getSetting("labelColor") === "object"
      ? ((sigma.getSetting("labelColor") as { color?: string }).color ??
        "#1a1815")
      : "#1a1815";

  const parts: string[] = [];
  parts.push(
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<svg xmlns="http://www.w3.org/2000/svg" ` +
      `viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`,
  );
  parts.push(`<rect width="${w}" height="${h}" fill="${escapeXml(bg)}" />`);

  // Edges
  parts.push(`<g stroke-opacity="0.45">`);
  graph.forEachEdge((_id, attr, source, target) => {
    if (
      !isGraphNodeVisible(graph, source) ||
      !isGraphNodeVisible(graph, target)
    ) {
      return;
    }
    const sx = graph.getNodeAttribute(source, "x") as number;
    const sy = graph.getNodeAttribute(source, "y") as number;
    const tx = graph.getNodeAttribute(target, "x") as number;
    const ty = graph.getNodeAttribute(target, "y") as number;
    const p1 = sigma.graphToViewport({ x: sx, y: sy });
    const p2 = sigma.graphToViewport({ x: tx, y: ty });
    let color = (attr["color"] as string) ?? "#5c5851";
    const zAvg = (zOf(source) + zOf(target)) / 2;
    if (zAvg > 0) color = fadeAlpha(color, 1 - DEPTH_EDGE_FADE * zAvg);
    const size = (attr["size"] as number) ?? 1;
    parts.push(
      `<line x1="${p1.x.toFixed(2)}" y1="${p1.y.toFixed(2)}" ` +
        `x2="${p2.x.toFixed(2)}" y2="${p2.y.toFixed(2)}" ` +
        `stroke="${escapeXml(color)}" stroke-width="${size}" />`,
    );
  });
  parts.push(`</g>`);

  // Nodes + labels
  const labelThreshold = (sigma.getSetting("labelRenderedSizeThreshold") ??
    7) as number;
  parts.push(`<g>`);
  graph.forEachNode((id, attr) => {
    if (!isGraphNodeVisible(graph, id)) return;
    const gx = attr["x"] as number;
    const gy = attr["y"] as number;
    let size = (attr["size"] as number) ?? 4;
    let color = (attr["color"] as string) ?? "#1a1815";
    const z = zOf(id);
    if (z > 0) {
      size *= depthSizeFactor(z);
      color = (attr["depthColor"] as string | undefined) ?? color;
    }
    const label = (attr["label"] as string) ?? id;
    const p = sigma.graphToViewport({ x: gx, y: gy });
    const scaled = size / Math.sqrt(sigma.getCamera().ratio);
    parts.push(
      `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" ` +
        `r="${scaled.toFixed(2)}" fill="${escapeXml(color)}" />`,
    );
    if (scaled >= labelThreshold) {
      parts.push(
        `<text x="${(p.x + scaled + 3).toFixed(2)}" ` +
          `y="${(p.y + 4).toFixed(2)}" ` +
          `font-family="${escapeXml(labelFont)}" font-size="11" ` +
          `fill="${escapeXml(labelColor)}">${escapeXml(label)}</text>`,
      );
    }
  });
  parts.push(`</g>`);
  parts.push(`</svg>`);

  return parts.join("");
}

/** Graphology export payload restricted to visible nodes and their edges. */
export function serializeVisibleGraph(
  graph: Graph,
): ReturnType<Graph["export"]> {
  const data = graph.export();
  const visible = new Set(
    data.nodes
      .filter((node) => isGraphNodeVisible(graph, node.key))
      .map((node) => node.key),
  );
  return {
    ...data,
    nodes: data.nodes.filter((node) => visible.has(node.key)),
    edges: data.edges.filter(
      (edge) => visible.has(edge.source) && visible.has(edge.target),
    ),
  };
}

export function exportGraphJson(graph: Graph): void {
  const data = serializeVisibleGraph(graph);
  triggerDownload(
    JSON.stringify(data, null, 2),
    `loom-graph-${timestamp()}.json`,
    "application/json",
  );
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
