import { useMemo } from "react";
import type { ReactNode } from "react";
import { useApp } from "../../context/app-ctx";
import type { Note, NodeType } from "../../data/types";
import { Dot } from "../primitives/Dot";

interface Section {
  folder: string;
  type: NodeType;
  notes: Note[];
}

const FOLDER_ORDER: { folder: string; type: NodeType }[] = [
  { folder: "daily", type: "daily" },
  { folder: "projects", type: "project" },
  { folder: "topics", type: "topic" },
  { folder: "people", type: "people" },
  { folder: "captures", type: "capture" },
  { folder: "reading", type: "custom" },
  { folder: "scratch", type: "custom" },
  { folder: "agents", type: "people" },
];

export function Tree(): ReactNode {
  const { notes, currentNoteId, openNote } = useApp();

  const sections = useMemo<Section[]>(() => {
    const byFolder = new Map<string, Note[]>();
    for (const n of notes) {
      const arr = byFolder.get(n.folder) ?? [];
      arr.push(n);
      byFolder.set(n.folder, arr);
    }
    const out: Section[] = [];
    for (const f of FOLDER_ORDER) {
      const arr = byFolder.get(f.folder);
      if (!arr || arr.length === 0) continue;
      out.push({
        folder: f.folder,
        type: f.type,
        notes: [...arr].sort((a, b) =>
          a.type === "daily"
            ? b.title.localeCompare(a.title)
            : a.title.localeCompare(b.title),
        ),
      });
    }
    return out;
  }, [notes]);

  const linkCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notes) {
      m.set(n.id, (m.get(n.id) ?? 0) + n.links.length);
      for (const l of n.links) m.set(l, (m.get(l) ?? 0) + 1);
    }
    return m;
  }, [notes]);

  return (
    <aside className="tree" role="tree">
      <div className="vault-badge">loom-vault</div>
      {sections.map((s) => (
        <div key={s.folder}>
          <div className="tree-section">{s.folder}</div>
          {s.notes.map((n) => (
            <button
              key={n.id}
              role="treeitem"
              aria-current={currentNoteId === n.id ? "page" : undefined}
              className="tree-row"
              onClick={() => openNote(n.id)}
            >
              <Dot type={n.type} />
              <span className="tree-row-name">{n.title}</span>
              <span className="tree-row-count">{linkCount.get(n.id) ?? 0}</span>
            </button>
          ))}
        </div>
      ))}
    </aside>
  );
}
