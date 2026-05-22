import { useEffect, useMemo, useRef, useState } from "react";
import type { TreeNode } from "../../lib/api";
import { fetchTree } from "../../lib/api";
import styles from "./FileTree.module.css";

interface FileTreeProps {
  activeFile: string | null;
  onFileSelect: (noteId: string) => void;
  onCreateNote?: () => void;
}

const NOTE_TYPE_COLORS: Record<string, string> = {
  project: "var(--node-project)",
  topic: "var(--node-topic)",
  person: "var(--node-person)",
  daily: "var(--node-daily)",
  capture: "var(--node-capture)",
  custom: "var(--node-custom)",
};

function dotColor(noteType: string): string {
  return NOTE_TYPE_COLORS[noteType] ?? "var(--text-secondary)";
}

function matchesFilter(node: TreeNode, filter: string): boolean {
  const lower = filter.toLowerCase();
  if (node.name.toLowerCase().includes(lower)) return true;
  if (node.children.some((c) => matchesFilter(c, lower))) return true;
  return false;
}

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  filter: string;
  activeFile: string | null;
  expanded: Record<string, boolean>;
  onToggle: (path: string) => void;
  onFileSelect: (noteId: string) => void;
}

function TreeRow({
  node,
  depth,
  filter,
  activeFile,
  expanded,
  onToggle,
  onFileSelect,
}: TreeRowProps) {
  const noteId = node.note_id;
  const isActive = !node.is_dir && activeFile === noteId;
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive && rowRef.current) {
      rowRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isActive]);

  if (filter && !matchesFilter(node, filter)) return null;

  const isOpen = expanded[node.path] ?? true;
  const paddingLeft = 10 + depth * 14;

  if (node.is_dir) {
    return (
      <>
        <div className={styles.row} style={{ paddingLeft }} onClick={() => onToggle(node.path)}>
          <span className={styles.arrow}>{isOpen ? "\u25BE" : "\u25B8"}</span>
          <span className={`${styles.name} ${styles.folderName}`}>{node.name}</span>
        </div>
        {isOpen &&
          node.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              filter={filter}
              activeFile={activeFile}
              expanded={expanded}
              onToggle={onToggle}
              onFileSelect={onFileSelect}
            />
          ))}
      </>
    );
  }

  const label = node.name.replace(/\.md$/, "");

  return (
    <div
      ref={rowRef}
      className={`${styles.row}${isActive ? ` ${styles.rowActive}` : ""}`}
      style={{ paddingLeft: paddingLeft + 16 }}
      onClick={() => noteId && onFileSelect(noteId)}
    >
      <span className={styles.dot} style={{ backgroundColor: dotColor(node.note_type) }} />
      <span className={styles.name}>{label}</span>
      {node.tag_count > 0 && <span className={styles.count}>{node.tag_count}</span>}
    </div>
  );
}

export function FileTree({ activeFile, onFileSelect, onCreateNote }: FileTreeProps) {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      fetchTree()
        .then((data) => {
          if (!cancelled) setTree(data);
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e.message);
        });
    };

    load();
    const interval = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const vaultName = useMemo(() => {
    if (!tree) return "";
    return tree.name === "threads" ? "vault" : tree.name;
  }, [tree]);

  function handleToggle(path: string) {
    setExpanded((prev) => ({ ...prev, [path]: !prev[path] }));
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.vaultBadge}>{vaultName}</span>
        <span className={styles.headerSpacer} />
        {onCreateNote && (
          <button className={styles.addBtn} title="Create note" onClick={onCreateNote}>
            +
          </button>
        )}
      </div>

      <div className={styles.filterWrap}>
        <input
          className={styles.filterInput}
          type="text"
          placeholder="Filter files..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className={styles.treeList}>
        {error && <div className={styles.error}>{error}</div>}
        {!tree && !error && <div className={styles.loading}>Loading...</div>}
        {tree &&
          tree.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={0}
              filter={filter}
              activeFile={activeFile}
              expanded={expanded}
              onToggle={handleToggle}
              onFileSelect={onFileSelect}
            />
          ))}
      </div>
    </aside>
  );
}
