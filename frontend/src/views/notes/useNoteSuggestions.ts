import { useCallback, useEffect, useMemo, useState } from "react";
import {
  acceptConnection,
  dismissConnection,
  getConnections,
} from "@/api/connections";
import { useApp } from "@/context/app-ctx";
import { readDemoMode } from "@/data/demoMode";
import type { Note } from "@/data/types";

export interface LinkSuggestion {
  targetId: string;
  targetTitle: string;
  reason: string;
  score: number | null;
  sourceModified: string;
  targetModified: string;
}

const DISMISSED_KEY = (vault: string) => `loom:dismissed-links:v1:${vault}`;

function readDismissed(vault: string): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY(vault));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeDismissed(vault: string, set: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY(vault), JSON.stringify([...set]));
  } catch {
    // Dismissal just won't survive a reload.
  }
}

/** Suggested links stored in the note itself (demo mode has no backend). */
function fromEvidence(
  note: Note,
  byId: (id: string) => Note | undefined,
): LinkSuggestion[] {
  const evidence = note.extra?.link_evidence;
  if (!Array.isArray(evidence)) return [];
  return evidence.flatMap((e: Record<string, unknown>) => {
    if (e.state !== "suggested" || e.source_id !== note.id) return [];
    const target = byId(String(e.target_id));
    if (!target) return [];
    return [
      {
        targetId: target.id,
        targetTitle: target.title,
        reason: typeof e.reason === "string" ? e.reason : "",
        score: typeof e.score === "number" ? e.score : null,
        sourceModified: note.contentVersion ?? note.modified,
        targetModified: target.contentVersion ?? target.modified,
      },
    ];
  });
}

/**
 * Spider's suggested links from this note, minus dismissed ones. Linking
 * accepts the suggestion (the backend appends the wikilink); dismissal is
 * remembered locally until the backend can store it (ui-backend-gaps §6).
 */
export function useNoteSuggestions(note: Note | null) {
  const { config, noteById, updateNote, pushToast } = useApp();
  const vault = config?.active_vault ?? "default";
  const demo = readDemoMode();
  const [remote, setRemote] = useState<{
    key: string;
    items: LinkSuggestion[];
  } | null>(null);
  const [dismissed, setDismissed] = useState(() => readDismissed(vault));
  const key = note ? `${note.id}@${note.contentVersion ?? note.modified}` : "";

  useEffect(() => {
    if (!note || demo) return;
    let active = true;
    getConnections(note.id).then(
      ({ connections }) =>
        active &&
        setRemote({
          key,
          items: connections
            .filter(
              (c) => c.state === "suggested" && c.direction === "outgoing",
            )
            .map((c) => ({
              targetId: c.target_id,
              targetTitle: c.target_title ?? c.target_id,
              reason: c.rationale,
              score: c.score,
              sourceModified: c.source_modified,
              targetModified: c.target_modified,
            })),
        }),
      () => active && setRemote({ key, items: [] }),
    );
    return () => {
      active = false;
    };
  }, [note, demo, key]);

  const all = useMemo(() => {
    if (!note) return [];
    if (demo) return fromEvidence(note, noteById);
    return remote?.key === key ? remote.items : [];
  }, [note, demo, noteById, remote, key]);

  const suggestions = all.filter(
    (s) => !dismissed.has(`${note?.id}->${s.targetId}`),
  );

  const dismiss = useCallback(
    async (s: LinkSuggestion) => {
      if (!note) return;
      const next = new Set(dismissed).add(`${note.id}->${s.targetId}`);
      setDismissed(next);
      writeDismissed(vault, next);
      if (!demo)
        await dismissConnection({
          source_id: note.id,
          target_id: s.targetId,
        }).catch(() => false);
    },
    [note, dismissed, vault, demo],
  );

  const link = useCallback(
    async (s: LinkSuggestion) => {
      if (!note) return;
      try {
        if (demo) {
          const evidence =
            (note.extra?.link_evidence as Record<string, unknown>[]) ?? [];
          updateNote({
            ...note,
            body: `${note.body.trimEnd()}\n\n[[${s.targetTitle}]]\n`,
            links: [...new Set([...note.links, s.targetId])],
            extra: {
              ...note.extra,
              link_evidence: evidence.map((e) =>
                e.target_id === s.targetId
                  ? { ...e, state: "user_accepted" }
                  : e,
              ),
            },
          });
        } else {
          await acceptConnection({
            source_id: note.id,
            target_id: s.targetId,
            source_modified: s.sourceModified,
            target_modified: s.targetModified,
          });
        }
        pushToast({
          icon: "⟷",
          agent: "spider",
          body: `Linked [[${s.targetTitle}]]`,
        });
      } catch (err) {
        pushToast({
          icon: "⚠",
          agent: "spider",
          body: err instanceof Error ? err.message : "Could not add the link",
        });
      }
    },
    [note, demo, updateNote, pushToast],
  );

  return { suggestions, link, dismiss };
}
