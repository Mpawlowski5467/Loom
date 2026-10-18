import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import type { Note } from "../data/types";
import { useNoteRouting, useRoute } from "./useRouteNavigation";

const note = (
  id: string,
  folder: string,
  filename: string,
  modified = "2026-01-01",
) => ({ id, folder, filename, modified }) as Note;

function Harness({ initial }: { initial: Note[] }) {
  const [notes, setNotes] = useState(initial);
  const api = useRoute();
  const current = useNoteRouting(api, notes, true);
  const { pathname, search } = useLocation();
  return (
    <>
      <output aria-label="url">{pathname + search}</output>
      <output aria-label="note">{current ?? "none"}</output>
      <button onClick={() => api.openNote("b", "Goals")}>open b</button>
      <button
        onClick={() =>
          setNotes([note("a", "projects", "cache-plan-v2.md"), initial[1]!])
        }
      >
        rename a
      </button>
    </>
  );
}

function renderAt(path: string, notes: Note[]) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Harness initial={notes} />
    </MemoryRouter>,
  );
}

const NOTES = [
  note("a", "projects", "cache-plan.md", "2026-01-02"),
  note("b", "topics", "latency.md", "2026-01-05"),
];

describe("note routing", () => {
  it("resolves a note by its path", () => {
    renderAt("/notes/projects/cache-plan", NOTES);
    expect(screen.getByLabelText("note")).toHaveTextContent("a");
  });

  it("canonicalises /notes?id= and keeps the heading", () => {
    renderAt("/notes?id=a&heading=Goals", NOTES);
    expect(screen.getByLabelText("url")).toHaveTextContent(
      "/notes/projects/cache-plan?heading=Goals",
    );
  });

  it("opens the most recent note for a bare /notes", () => {
    renderAt("/notes", NOTES);
    expect(screen.getByLabelText("url")).toHaveTextContent(
      "/notes/topics/latency",
    );
  });

  it("shows nothing for a path that matches no note", () => {
    renderAt("/notes/projects/gone", NOTES);
    expect(screen.getByLabelText("note")).toHaveTextContent("none");
  });

  it("follows a note when a rename changes its path", () => {
    renderAt("/notes/projects/cache-plan", NOTES);
    act(() => screen.getByRole("button", { name: "rename a" }).click());
    expect(screen.getByLabelText("note")).toHaveTextContent("a");
    expect(screen.getByLabelText("url")).toHaveTextContent(
      "/notes/projects/cache-plan-v2",
    );
  });

  it("openNote navigates to the note's path", () => {
    renderAt("/graph", NOTES);
    act(() => screen.getByRole("button", { name: "open b" }).click());
    expect(screen.getByLabelText("url")).toHaveTextContent(
      "/notes/topics/latency?heading=Goals",
    );
  });
});
