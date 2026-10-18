import type Graph from "graphology";
import type Sigma from "sigma";
import type { NoteId } from "../data/types";
import { ratioToTier } from "./reducers";
import type { GraphTuning } from "./tuning";

interface Ref<T> {
  current: T;
}

export interface SigmaEventArgs {
  sigma: Sigma;
  graph: Graph;
  host: HTMLElement;
  tuning: GraphTuning;
  isDragging: Ref<boolean>;
  justDragged: Ref<boolean>;
  openNote: (id: NoteId) => void;
  onEdgeClick?: (sourceId: NoteId, targetId: NoteId) => void;
  setGraphFocusId: (id: NoteId | null) => void;
  setGraphSelectedId: (id: NoteId | null) => void;
}

/**
 * Wire the camera label-tier listener and the node/edge/stage pointer events.
 * Returns a detach for the camera listener; the Sigma events die with
 * ``sigma.kill()``.
 */
export function wireSigmaEvents(args: SigmaEventArgs): () => void {
  const { sigma, tuning, isDragging } = args;

  // Camera ratio drives the label tier — refresh only when the tier flips,
  // not on every zoom frame.
  const onCameraUpdate = (): void => {
    const r = sigma.getCamera().ratio;
    const prevRatio = tuning.cameraRatio;
    tuning.cameraRatio = r;
    const tier = ratioToTier(r);
    const showRatio = tuning.labelShowRatio;
    const crossedShowRatio = prevRatio <= showRatio !== r <= showRatio;
    if (tier !== tuning.labelTier || crossedShowRatio) {
      tuning.labelTier = tier;
      sigma.refresh({ skipIndexation: true });
    }
  };
  sigma.getCamera().on("updated", onCameraUpdate);

  sigma.on("enterNode", ({ node }) => {
    if (isDragging.current) return;
    tuning.hovered = node;
    sigma.refresh({ skipIndexation: true });
  });
  sigma.on("leaveNode", () => {
    if (isDragging.current) return;
    tuning.hovered = null;
    sigma.refresh({ skipIndexation: true });
  });
  wireClicks(args);
  return () => sigma.getCamera().off("updated", onCameraUpdate);
}

function wireClicks(args: SigmaEventArgs): void {
  const { sigma, graph, host, tuning, isDragging, justDragged } = args;
  const { openNote, onEdgeClick, setGraphFocusId, setGraphSelectedId } = args;
  const suppressed = (): boolean => isDragging.current || justDragged.current;

  sigma.on("clickNode", ({ node }) => {
    if (suppressed()) return;
    host.focus({ preventScroll: true });
    setGraphSelectedId(node);
    // Orbit selection preserves the existing focus-first scene behavior;
    // selection remains separate so clearing the card does not reshuffle.
    if (tuning.graphMode === "orbit") setGraphFocusId(node);
  });
  sigma.on("clickEdge", ({ edge }) => {
    if (suppressed()) return;
    const [source, target] = graph.extremities(edge);
    host.focus({ preventScroll: true });
    onEdgeClick?.(source as NoteId, target as NoteId);
    setGraphSelectedId(source as NoteId);
    if (tuning.graphMode === "orbit") setGraphFocusId(source as NoteId);
  });
  sigma.on("clickStage", () => {
    if (suppressed()) return;
    host.focus({ preventScroll: true });
    setGraphSelectedId(null);
  });
  sigma.on("doubleClickNode", ({ node, event }) => {
    event.preventSigmaDefault?.();
    openNote(node);
  });
}
