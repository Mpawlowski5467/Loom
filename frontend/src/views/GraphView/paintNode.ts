import type { NodeObject } from "react-force-graph-2d";
import { type GraphColors, type LoomNode, nodeRadius } from "./types";

interface PaintContext {
  activeFile: string | null;
  hoveredNode: string | null;
  neighborSet: Set<string> | null;
  colors: GraphColors;
}

/** Render one graph node with selection / hover / dimming and labels. */
export function paintNode(
  node: NodeObject<LoomNode>,
  ctx: CanvasRenderingContext2D,
  globalScale: number,
  paintCtx: PaintContext,
): void {
  const { activeFile, hoveredNode, neighborSet, colors } = paintCtx;
  const id = node.id as string;
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const r = nodeRadius(node);
  const isSelected = id === activeFile;
  const isHovered = id === hoveredNode;
  const isDimmed = neighborSet !== null && !neighborSet.has(id);
  const color = colors.nodeHex[node.type ?? ""] ?? colors.fallback;

  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);

  if (isDimmed) {
    ctx.fillStyle = colors.dimmedNode;
  } else {
    ctx.fillStyle = color;
    if ((node.linkCount ?? 0) >= 4 && !isDimmed) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
    }
  }
  ctx.fill();
  ctx.shadowBlur = 0;

  if (isSelected) {
    ctx.beginPath();
    ctx.arc(x, y, r + 2, 0, 2 * Math.PI);
    ctx.strokeStyle = colors.selected;
    ctx.lineWidth = 2 / globalScale;
    ctx.stroke();
  }

  if (isHovered && !isSelected) {
    ctx.beginPath();
    ctx.arc(x, y, r + 1.5, 0, 2 * Math.PI);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 / globalScale;
    ctx.stroke();
  }

  const showLabel =
    isSelected ||
    isHovered ||
    (neighborSet !== null && neighborSet.has(id) && !isDimmed) ||
    globalScale > 1.5 ||
    (globalScale > 0.8 && (node.linkCount ?? 0) >= 3);

  if (!showLabel || isDimmed) return;

  const label = node.title ?? "";
  const baseFontSize = isHovered || isSelected ? 12 : 11;
  const fontSize = baseFontSize / globalScale;
  ctx.font = `500 ${fontSize}px Sora, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const metrics = ctx.measureText(label);
  const textWidth = metrics.width;
  const textHeight = fontSize;
  const pad = 2 / globalScale;
  ctx.fillStyle = colors.labelBg;
  ctx.fillRect(
    x - textWidth / 2 - pad,
    y + r + 2 / globalScale - pad / 2,
    textWidth + pad * 2,
    textHeight + pad,
  );

  if (isSelected) {
    ctx.fillStyle = colors.selected;
  } else if (isHovered) {
    ctx.fillStyle = colors.labelBright;
  } else {
    ctx.fillStyle = colors.label;
  }
  ctx.fillText(label, x, y + r + 2 / globalScale);
}

export function paintPointerArea(
  node: NodeObject<LoomNode>,
  color: string,
  ctx: CanvasRenderingContext2D,
): void {
  const r = nodeRadius(node) + 4;
  ctx.beginPath();
  ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
}
