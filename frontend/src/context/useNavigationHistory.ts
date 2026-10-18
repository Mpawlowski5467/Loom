import { useEffect, useRef } from "react";
import type { Tab } from "../data/types";

const views = new Set<string>([
  "graph",
  "thread",
  "inbox",
  "board",
  "settings",
  "today",
]);
export function readHomeView(): "today" | "graph" {
  try {
    return localStorage.getItem("loom:home-view:v1") === "today"
      ? "today"
      : "graph";
  } catch {
    return "graph";
  }
}
export function writeHomeView(view: "today" | "graph"): void {
  localStorage.setItem("loom:home-view:v1", view);
}
export function readNavigation(): {
  tab: Tab;
  noteId: string | null;
  heading: string;
} {
  if (typeof window === "undefined")
    return { tab: "graph", noteId: null, heading: "" };
  const query = new URL(window.location.href).searchParams;
  const tab = query.get("view") ?? readHomeView();
  return {
    tab: views.has(tab) ? (tab as Tab) : "graph",
    noteId: query.get("note"),
    heading: query.get("heading") ?? "",
  };
}

export function useNavigationHistory(options: {
  tab: Tab;
  noteId: string | null;
  heading: string;
  setTab: (tab: Tab) => void;
  setNoteId: (id: string | null) => void;
  setHeading: (heading: string) => void;
}): void {
  const first = useRef(true);
  const popping = useRef(false);
  const { tab, noteId, heading, setTab, setNoteId, setHeading } = options;
  useEffect(() => {
    const onPop = () => {
      popping.current = true;
      const state = readNavigation();
      setTab(state.tab);
      setNoteId(state.noteId);
      setHeading(state.heading);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [setHeading, setNoteId, setTab]);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", tab);
    if (noteId) url.searchParams.set("note", noteId);
    else url.searchParams.delete("note");
    if (heading) url.searchParams.set("heading", heading);
    else url.searchParams.delete("heading");
    if (first.current) {
      window.history.replaceState(null, "", url);
      first.current = false;
    } else if (!popping.current && url.href !== window.location.href)
      window.history.pushState(null, "", url);
    popping.current = false;
  }, [heading, noteId, tab]);
}
