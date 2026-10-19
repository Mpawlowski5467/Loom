import { useState } from "react";
import { useNavigate } from "react-router";
import { formatRunResult, scanNoteWithSpider } from "@/api/agents";
import { createCapture } from "@/api/captures";
import { describeApiError } from "@/api/client";
import { useApp } from "@/context/app-ctx";
import type { Note } from "@/data/types";
import type { PaletteItem } from "./items";

/** What choosing a palette item does. Every path closes the palette. */
export function usePaletteCommands(query: string) {
  const app = useApp();
  const navigate = useNavigate();
  const [spiderTarget, setSpiderTarget] = useState<Note | null>(null);
  const close = () => app.setPaletteOpen(false);
  const text = query.trim();

  const openNote = (id: string) => {
    close();
    app.openNote(id);
  };
  const showInGraph = (id: string) => {
    close();
    app.flyToNode(id);
  };

  const capture = async () => {
    if (!text) return;
    close();
    try {
      await createCapture({
        title: text.split("\n")[0]!.slice(0, 100),
        body: text,
        source: "manual:palette",
      });
      app.pushToast({
        icon: "✓",
        agent: "weaver",
        body: `Captured "${text.slice(0, 60)}" to Inbox`,
      });
    } catch (err) {
      app.pushToast({
        icon: "⚠",
        agent: "sentinel",
        body: describeApiError(err, "Capture failed"),
      });
    }
  };

  const runSpider = async (note: Note) => {
    const result = await scanNoteWithSpider(note.id);
    setSpiderTarget(null);
    close();
    app.pushToast({
      icon: "✓",
      agent: "spider",
      body: formatRunResult("spider", { ...result }),
    });
  };

  const select = (item: PaletteItem) => {
    if (item.kind === "note") return openNote(item.noteId);
    if (item.kind === "agent") {
      close();
      navigate(`/board?agent=${encodeURIComponent(item.agent.id)}`);
      return;
    }
    switch (item.id) {
      case "capture":
        return void capture();
      case "council":
        close();
        app.setCouncilPrefill(text);
        return app.setTab("board");
      case "spider":
        return setSpiderTarget(item.target ?? null);
      case "new-note":
        close();
        return app.setNewNoteOpen(true);
      case "quick-capture":
        close();
        return app.setQuickCaptureOpen(true);
    }
  };

  return {
    select,
    openNote,
    showInGraph,
    capture,
    spiderTarget,
    cancelSpider: () => setSpiderTarget(null),
    runSpider,
  };
}
