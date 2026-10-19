import type { TreeNode } from "@/api/notes";

export interface TypeOption {
  value: string;
  label: string;
  /** Backend folder this type lands in when no folder is picked. */
  defaultFolder: string;
}

export const TYPE_OPTIONS: TypeOption[] = [
  { value: "topic", label: "Topic", defaultFolder: "topics" },
  { value: "project", label: "Project", defaultFolder: "projects" },
  { value: "person", label: "Person", defaultFolder: "people" },
  { value: "daily", label: "Daily", defaultFolder: "daily" },
  { value: "capture", label: "Capture", defaultFolder: "captures" },
];

/** Sentinel value for "no override: use the type's default folder". */
export const FOLDER_AUTO = "__auto__";

/** Depth-first folder paths (nested included, alpha per level, dot-dirs out). */
export function collectFolderPaths(node: TreeNode, prefix = ""): string[] {
  const dirs = (node.children ?? [])
    .filter((c) => c.is_dir && !c.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name));
  const out: string[] = [];
  for (const child of dirs) {
    const path = prefix ? `${prefix}/${child.name}` : child.name;
    out.push(path, ...collectFolderPaths(child, path));
  }
  return out;
}

export function cleanTag(raw: string): string {
  return raw.trim().replace(/^#/, "");
}
