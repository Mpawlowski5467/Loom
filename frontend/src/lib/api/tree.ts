import { request } from "./common";

export interface TreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  note_id: string;
  note_type: string;
  tag_count: number;
  modified: string;
  children: TreeNode[];
}

export function fetchTree(): Promise<TreeNode> {
  return request<TreeNode>("/api/tree");
}
