/**
 * Graph event handlers: hover, click, drag, pin, selection.
 */

import type Graph from "graphology";
import type Sigma from "sigma";
import type FA2LayoutSupervisor from "graphology-layout-forceatlas2/worker";
import { animateToNode } from "./camera";

export interface GraphEventRefs {
  graph: Graph;
  sigma: Sigma;
  supervisor: FA2LayoutSupervisor | null;
  hoveredNode: React.MutableRefObject<string | null>;
  draggedNode: React.MutableRefObject<string | null>;
  pinnedNodes: React.MutableRefObject<Set<string>>;
  selectedNode: React.MutableRefObject<string | null>;
  onFileSelect: React.MutableRefObject<(id: string) => void>;
}

/**
 * Wire up all Sigma event listeners. Returns a cleanup function.
 */
export function setupEvents(refs: GraphEventRefs): () => void {
  const { graph, sigma: renderer, hoveredNode, draggedNode, pinnedNodes, selectedNode, onFileSelect } = refs;
  const canvas = renderer.getContainer();
  const cleanups: (() => void)[] = [];

  // -- Hover events -----------------------------------------------------------

  const onEnterNode = ({ node }: { node: string }) => {
    hoveredNode.current = node;
    canvas.style.cursor = "pointer";
    renderer.scheduleRefresh();
  };

  const onLeaveNode = () => {
    hoveredNode.current = null;
    canvas.style.cursor = draggedNode.current ? "grabbing" : "default";
    renderer.scheduleRefresh();
  };

  renderer.on("enterNode", onEnterNode);
  renderer.on("leaveNode", onLeaveNode);
  cleanups.push(() => {
    renderer.off("enterNode", onEnterNode);
    renderer.off("leaveNode", onLeaveNode);
  });

  // -- Drag events ------------------------------------------------------------

  let wasDragged = false;

  const onDownNode = (e: { node: string; preventSigmaDefault: () => void }) => {
    draggedNode.current = e.node;
    wasDragged = false;
    canvas.style.cursor = "grabbing";

    // Stop layout during drag
    if (refs.supervisor?.isRunning()) {
      refs.supervisor.stop();
    }
    graph.setNodeAttribute(e.node, "fixed", true);
    e.preventSigmaDefault();
  };

  renderer.on("downNode", onDownNode);
  cleanups.push(() => renderer.off("downNode", onDownNode));

  const mouseCaptor = renderer.getMouseCaptor();

  const onMouseMove = (e: { x: number; y: number }) => {
    if (!draggedNode.current) return;
    wasDragged = true;
    const pos = renderer.viewportToGraph(e);
    graph.setNodeAttribute(draggedNode.current, "x", pos.x);
    graph.setNodeAttribute(draggedNode.current, "y", pos.y);
  };

  mouseCaptor.on("mousemovebody", onMouseMove);
  cleanups.push(() => mouseCaptor.off("mousemovebody", onMouseMove));

  const onMouseUp = () => {
    if (draggedNode.current) {
      if (!pinnedNodes.current.has(draggedNode.current)) {
        graph.setNodeAttribute(draggedNode.current, "fixed", false);
      }
      // Small delay before clearing draggedNode so clickNode can check wasDragged
      const node = draggedNode.current;
      draggedNode.current = null;
      canvas.style.cursor = hoveredNode.current ? "pointer" : "default";

      // Bump dragged node size back
      const baseSize = graph.getNodeAttribute(node, "baseSize") as number | undefined;
      if (baseSize) {
        graph.setNodeAttribute(node, "size", baseSize);
      }
    }
  };

  mouseCaptor.on("mouseup", onMouseUp);
  cleanups.push(() => mouseCaptor.off("mouseup", onMouseUp));

  // -- Double-click to pin/unpin ----------------------------------------------

  const onDoubleClick = (e: { node: string; preventSigmaDefault: () => void }) => {
    e.preventSigmaDefault();
    const node = e.node;
    if (pinnedNodes.current.has(node)) {
      pinnedNodes.current.delete(node);
      graph.setNodeAttribute(node, "pinned", false);
      graph.setNodeAttribute(node, "fixed", false);
    } else {
      pinnedNodes.current.add(node);
      graph.setNodeAttribute(node, "pinned", true);
      graph.setNodeAttribute(node, "fixed", true);
    }
    renderer.scheduleRefresh();
  };

  renderer.on("doubleClickNode", onDoubleClick);
  cleanups.push(() => renderer.off("doubleClickNode", onDoubleClick));

  // -- Click to select --------------------------------------------------------

  const onClickNode = ({ node }: { node: string }) => {
    // Don't fire click after drag
    if (wasDragged) {
      wasDragged = false;
      return;
    }
    selectedNode.current = node;
    onFileSelect.current(node);
    renderer.scheduleRefresh();
  };

  renderer.on("clickNode", onClickNode);
  cleanups.push(() => renderer.off("clickNode", onClickNode));

  // Click stage to deselect
  const onClickStage = () => {
    if (selectedNode.current) {
      selectedNode.current = null;
      renderer.scheduleRefresh();
    }
  };

  renderer.on("clickStage", onClickStage);
  cleanups.push(() => renderer.off("clickStage", onClickStage));

  return () => {
    for (const fn of cleanups) fn();
  };
}

/**
 * Handle external activeFile changes: highlight and animate to node.
 */
export function selectExternalNode(
  sigma: Sigma,
  graph: Graph,
  selectedNode: React.MutableRefObject<string | null>,
  nodeId: string | null,
): void {
  selectedNode.current = nodeId;
  sigma.scheduleRefresh();

  if (nodeId && graph.hasNode(nodeId)) {
    animateToNode(sigma, graph, nodeId);
  }
}
