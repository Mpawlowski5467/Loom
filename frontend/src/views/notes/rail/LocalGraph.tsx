import { ArrowUpRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import Sigma from "sigma";
import { useApp } from "@/context/app-ctx";
import type { Note } from "@/data/types";
import { useThemeColors } from "@/theme/useThemeColors";
import { MAX_NEIGHBORS, buildLocalGraph } from "./localGraphModel";

/** Whether this browser can run Sigma (WebGL). False in test DOMs. */
function supportsWebGL(): boolean {
  if (typeof document === "undefined" || /jsdom/i.test(navigator.userAgent))
    return false;
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/** A small Sigma view of the note and its 1-hop neighbours. */
export function LocalGraph({ note }: { note: Note }) {
  const app = useApp();
  const { noteById, backlinksFor, openNote } = app;
  const colors = useThemeColors();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [webgl] = useState(supportsWebGL);

  const neighbors = useMemo(
    () =>
      [...new Set([...note.links, ...backlinksFor(note.id)])]
        .map((id) => noteById(id))
        .filter((n): n is Note => !!n && n.id !== note.id)
        .slice(0, MAX_NEIGHBORS),
    [note, noteById, backlinksFor],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !webgl) return;
    let sigma: Sigma | null = null;
    try {
      sigma = new Sigma(buildLocalGraph(note, neighbors, colors), host, {
        renderEdgeLabels: false,
        labelFont: "Geist Variable, ui-sans-serif, sans-serif",
        labelSize: 11,
        labelColor: { color: colors.secondaryForeground },
        labelRenderedSizeThreshold: 0,
        defaultEdgeColor: colors.borderStrong,
        stagePadding: 24,
        zoomingRatio: 1.3,
      });
      sigma.on("clickNode", ({ node }) => {
        if (node !== note.id) openNote(node);
      });
      sigma.on("enterNode", () => host.style.setProperty("cursor", "pointer"));
      sigma.on("leaveNode", () => host.style.removeProperty("cursor"));
    } catch {
      // Sigma couldn't start; the empty frame stays, links are in Related.
    }
    return () => sigma?.kill();
  }, [note, neighbors, colors, openNote, webgl]);

  const openInGraph = () => {
    app.setGraphSelectedId(note.id);
    app.flyToNode(note.id);
    app.setTab("graph");
  };

  return (
    <section aria-labelledby="rail-local-graph">
      <div className="mb-2 flex items-center justify-between">
        <h2
          id="rail-local-graph"
          className="text-xs font-medium text-muted-foreground"
        >
          Local graph
        </h2>
        <button
          type="button"
          onClick={openInGraph}
          className="inline-flex items-center gap-0.5 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Open in Graph
          <ArrowUpRight aria-hidden="true" className="size-3" />
        </button>
      </div>
      {!webgl ? (
        <ul className="flex flex-col gap-1 text-sm">
          {neighbors.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => openNote(n.id)}
                className="text-secondary-foreground hover:underline"
              >
                {n.title}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div
          ref={hostRef}
          role="img"
          aria-label={`${note.title} and ${neighbors.length} linked notes`}
          className="h-48 rounded-lg border border-border bg-background"
        />
      )}
      {neighbors.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">No links yet.</p>
      )}
    </section>
  );
}
