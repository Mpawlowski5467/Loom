import { useMemo } from "react";
import { getCSSVar, getNodeColorsHex } from "../../lib/constants";
import type { GraphColors } from "./types";

/** Resolve all graph canvas colors from CSS vars, re-reading on theme change. */
export function useGraphColors(theme: string): GraphColors {
  return useMemo(() => {
    const nodeHex = getNodeColorsHex();
    return {
      bg: getCSSVar("--graph-bg"),
      label: getCSSVar("--graph-label"),
      labelBright: getCSSVar("--text-primary"),
      edge: getCSSVar("--graph-edge") || "rgba(139,144,160,0.15)",
      edgeHover: getCSSVar("--graph-edge-hover") || "rgba(167,139,250,0.5)",
      selected: getCSSVar("--graph-selected"),
      dimmedNode: getCSSVar("--graph-dimmed") || "rgba(139,144,160,0.08)",
      dimmedEdge: getCSSVar("--graph-dimmed") || "rgba(139,144,160,0.04)",
      labelBg: theme === "light" ? "rgba(245,246,248,0.8)" : "rgba(17,19,24,0.75)",
      nodeHex,
      fallback: getCSSVar("--node-daily"),
    };
  }, [theme]);
}
