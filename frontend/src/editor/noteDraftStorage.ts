/** A deliberately small localStorage boundary for editor recovery drafts. */
export interface StoredNoteDraft {
  body: string;
  baseModified: string;
  savedAt: string;
}

const PREFIX = "loom:note-draft:v1";

function key(vaultId: string, noteId: string): string {
  return `${PREFIX}:${encodeURIComponent(vaultId)}:${encodeURIComponent(noteId)}`;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readNoteDraft(
  vaultId: string,
  noteId: string,
): StoredNoteDraft | null {
  try {
    const raw = storage()?.getItem(key(vaultId, noteId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as StoredNoteDraft).body !== "string" ||
      typeof (parsed as StoredNoteDraft).baseModified !== "string"
    ) {
      return null;
    }
    return parsed as StoredNoteDraft;
  } catch {
    return null;
  }
}

/** Returns false when the browser refuses persistence (private mode/quota). */
export function writeNoteDraft(
  vaultId: string,
  noteId: string,
  draft: StoredNoteDraft,
): boolean {
  try {
    const target = storage();
    if (!target) return false;
    target.setItem(key(vaultId, noteId), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function removeNoteDraft(vaultId: string, noteId: string): boolean {
  try {
    const target = storage();
    if (!target) return false;
    target.removeItem(key(vaultId, noteId));
    return true;
  } catch {
    return false;
  }
}

/** Ids of notes in this vault with a local recovery draft. */
export function listDraftNoteIds(vaultId: string): Set<string> {
  const ids = new Set<string>();
  const target = storage();
  if (!target) return ids;
  const prefix = `${PREFIX}:${encodeURIComponent(vaultId)}:`;
  try {
    for (let i = 0; i < target.length; i++) {
      const k = target.key(i);
      if (k?.startsWith(prefix))
        ids.add(decodeURIComponent(k.slice(prefix.length)));
    }
  } catch {
    // Storage unavailable: no markers.
  }
  return ids;
}
