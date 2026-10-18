import { useEffect, useMemo, useState } from "react";
import { listHistory, notePath, type HistoryEntry } from "@/api/history";
import { AgentAvatar } from "@/components/AgentAvatar";
import { actorLabel } from "@/data/actors";
import { formatRelative } from "@/data/formatDate";
import type { Note } from "@/data/types";

const LIMIT = 6;

interface ActivityRow {
  key: string;
  actor: string;
  text: string;
  at: string;
}

/** Recent agent and human activity on the note, newest first. */
export function NoteActivity({ note }: { note: Note }) {
  const [commits, setCommits] = useState<{ id: string; rows: HistoryEntry[] }>({
    id: "",
    rows: [],
  });

  useEffect(() => {
    let active = true;
    listHistory({
      path: notePath(note.folder, note.filename ?? `${note.id}.md`),
      limit: LIMIT,
    }).then(
      (rows) => active && setCommits({ id: note.id, rows }),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [note.id, note.folder, note.filename, note.modified]);

  const rows = useMemo<ActivityRow[]>(() => {
    const fromFrontmatter = note.history.map((h, i) => ({
      key: `fm-${i}`,
      actor: h.by,
      text: h.reason ? `${h.action} — ${h.reason}` : h.action,
      at: h.at,
    }));
    const fromGit = (commits.id === note.id ? commits.rows : []).map((c) => ({
      key: c.sha,
      actor: c.agents[0] ?? c.author,
      text: c.reason ? `${c.action} — ${c.reason}` : c.subject,
      at: c.date,
    }));
    // Git commits and frontmatter history overlap for agent writes; keep one
    // row per actor+minute, preferring the commit.
    const seen = new Set<string>();
    return [...fromGit, ...fromFrontmatter]
      .filter((r) => {
        const k = `${actorLabel(r.actor)}@${r.at.slice(0, 16)}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, LIMIT);
  }, [note, commits]);

  return (
    <section aria-labelledby="rail-activity">
      <h2
        id="rail-activity"
        className="mb-2 text-xs font-medium text-muted-foreground"
      >
        Agent activity
      </h2>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No activity recorded.</p>
      ) : (
        <ol className="relative flex flex-col gap-3 border-l border-border pl-4">
          {rows.map((r) => (
            <li key={r.key} className="relative flex gap-2 text-sm">
              <AgentAvatar
                actor={r.actor}
                className="absolute top-0 -left-[1.6rem]"
              />
              <div className="min-w-0">
                <p className="text-secondary-foreground">
                  <span className="font-medium text-foreground">
                    {actorLabel(r.actor)}
                  </span>{" "}
                  {r.text}
                </p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {formatRelative(r.at)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
