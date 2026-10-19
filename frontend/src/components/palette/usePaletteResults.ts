import { useMemo, useState } from "react";
import type { VaultSearch } from "@/api/search";
import { useApp } from "@/context/app-ctx";
import { buildPaletteGroups, type PaletteChip } from "./items";
import { localSearch } from "./localSearch";
import { usePaletteAgents } from "./usePaletteAgents";
import { usePaletteSearch } from "./usePaletteSearch";

/**
 * Everything the palette shows for a query: the search state, the groups,
 * the note the palette measures graph proximity from, and the timing readout.
 */
export function usePaletteResults(
  query: string,
  chip: PaletteChip,
  includeSuperseded: boolean,
) {
  const app = useApp();
  const contextId =
    app.tab === "notes"
      ? app.currentNoteId
      : app.tab === "graph"
        ? app.graphSelectedId
        : null;
  const contextNote = contextId ? (app.noteById(contextId) ?? null) : null;
  const state = usePaletteSearch(query, contextId ?? null, includeSuperseded);
  const agents = usePaletteAgents();

  // Keep the previous results on screen while the next query loads.
  const [shown, setShown] = useState<VaultSearch | null>(null);
  const fresh =
    state.status === "ok"
      ? state.search
      : state.status === "error"
        ? null
        : shown;
  if (state.status === "ok" && state.search !== shown) setShown(state.search);
  const offline = useMemo(
    () =>
      state.status === "error" ? localSearch(app.notes, query.trim()) : null,
    [state.status, app.notes, query],
  );
  const search = query.trim() ? (offline ?? fresh) : null;

  const groups = useMemo(
    () =>
      buildPaletteGroups({
        query,
        chip,
        includeSuperseded,
        hits: search?.hits ?? (query.trim() ? [] : null),
        notes: app.notes,
        noteById: app.noteById,
        slotOf: app.communities.slotOf,
        contextNote,
        agents,
      }),
    [
      query,
      chip,
      includeSuperseded,
      search,
      app.notes,
      app.noteById,
      app.communities.slotOf,
      contextNote,
      agents,
    ],
  );

  const readout =
    state.status === "loading"
      ? "searching…"
      : state.status === "error"
        ? "offline · titles only"
        : state.status === "ok"
          ? `${state.search.mode} · ${state.search.tookMs} ms`
          : null;
  return { contextNote, state, search, groups, readout };
}
