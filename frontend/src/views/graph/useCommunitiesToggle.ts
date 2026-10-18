import { useCallback, useState } from "react";

const KEY = "loom.graph.communities";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

/** Color nodes by community (default) or draw them all neutral; persisted. */
export function useCommunitiesToggle(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(read);
  const set = useCallback((next: boolean) => {
    setOn(next);
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // The choice just won't persist.
    }
  }, []);
  return [on, set];
}
