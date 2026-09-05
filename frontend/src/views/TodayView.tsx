import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { listCaptureJobs, type CaptureJob } from "../api/captures";
import { subscribeEventDomains } from "../api/events";
import { useApp } from "../context/app-ctx";
import type { Note } from "../data/types";
import { readHomeView, writeHomeView } from "../context/useNavigationHistory";

function pinKey(vault: string): string {
  return `loom:today:pinned-projects:v1:${vault}`;
}

function readPins(vault: string): string[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(pinKey(vault)) ?? "[]",
    );
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function writePins(vault: string, ids: string[]): void {
  try {
    localStorage.setItem(pinKey(vault), JSON.stringify(ids));
  } catch {
    /* optional convenience */
  }
}

function recentNotes(notes: Note[]): Note[] {
  return [...notes]
    .sort((a, b) => b.modified.localeCompare(a.modified))
    .slice(0, 8);
}

/** A compact daily launch point: what needs attention and what changed. */
export function TodayView(): ReactNode {
  const { notes, captures, config, openNote, setTab } = useApp();
  const vault = config?.active_vault ?? "default";
  const [pinnedState, setPinnedState] = useState(() => ({
    vault,
    ids: readPins(vault),
  }));
  const [jobState, setJobState] = useState<{
    vault: string;
    jobs: CaptureJob[];
    error: string;
  }>({ vault, jobs: [], error: "" });
  const [home, setHome] = useState(readHomeView);
  const [preferenceError, setPreferenceError] = useState("");

  const pins = pinnedState.vault === vault ? pinnedState.ids : readPins(vault);
  useEffect(() => {
    let ctrl: AbortController | null = null;
    const refresh = () => {
      ctrl?.abort();
      const request = new AbortController();
      ctrl = request;
      void listCaptureJobs(request.signal)
        .then((next) => {
          if (!request.signal.aborted)
            setJobState({ vault, jobs: next, error: "" });
        })
        .catch(() => {
          if (!request.signal.aborted)
            setJobState({ vault, jobs: [], error: "Failed to load jobs." });
        });
    };
    refresh();
    const unsubscribe = subscribeEventDomains(["capture-jobs"], refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      ctrl?.abort();
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [vault]);

  const projects = notes.filter((note) => note.type === "project");
  const pinnedProjects = pins
    .map((id) => projects.find((project) => project.id === id))
    .filter((note): note is Note => Boolean(note));
  const pending = captures.filter((capture) =>
    ["pending", "processing", "needs_review", "failed"].includes(
      capture.status,
    ),
  );
  const failedJobs =
    jobState.vault === vault
      ? jobState.jobs.filter((job) => job.status === "failed")
      : [];
  const standup = useMemo(
    () => recentNotes(notes.filter((note) => /standup/i.test(note.title)))[0],
    [notes],
  );
  const open = (note: Note) => {
    openNote(note.id);
    setTab("thread");
  };
  const togglePin = (id: string) => {
    const next = pins.includes(id)
      ? pins.filter((value) => value !== id)
      : [...pins, id];
    writePins(vault, next);
    setPinnedState({ vault, ids: next });
  };

  return (
    <div className="today-view">
      <header className="today-header">
        <div>
          <div className="settings-kicker">{vault}</div>
          <h1>Today</h1>
        </div>
        <p>Pick up the work that is already in motion.</p>
        <label>
          Start a new visit in{" "}
          <select
            aria-label="Default home view"
            value={home}
            onChange={(event) => {
              const view = event.target.value === "today" ? "today" : "graph";
              try {
                writeHomeView(view);
                setHome(view);
                setPreferenceError("");
              } catch {
                setPreferenceError(
                  "Browser storage is unavailable; the home preference could not be saved.",
                );
              }
            }}
          >
            <option value="graph">Graph</option>
            <option value="today">Today</option>
          </select>
        </label>
        {preferenceError && <p role="alert">{preferenceError}</p>}
      </header>
      <section className="today-grid" aria-label="Today overview">
        <article className="today-card">
          <h2>Inbox</h2>
          <strong>{pending.length}</strong>
          <span>captures need attention</span>
          <button type="button" onClick={() => setTab("inbox")}>
            Open Inbox
          </button>
        </article>
        <article className="today-card">
          <h2>Failed jobs</h2>
          <strong>{failedJobs.length}</strong>
          <span>
            {failedJobs.length
              ? (failedJobs[0]?.recommended_action ?? "Review the job history")
              : "No retry work"}
          </span>
          {jobState.vault === vault && jobState.error && (
            <span role="alert">{jobState.error}</span>
          )}
          <button type="button" onClick={() => setTab("inbox")}>
            Review jobs
          </button>
        </article>
        <article className="today-card">
          <h2>Latest standup</h2>
          {standup ? (
            <button
              type="button"
              className="today-note-link"
              onClick={() => open(standup)}
            >
              {standup.title}
            </button>
          ) : (
            <span>No standup note yet.</span>
          )}
        </article>
      </section>
      <section className="today-section">
        <div className="today-section-head">
          <h2>Pinned projects</h2>
          <span>{pinnedProjects.length}</span>
        </div>
        {pinnedProjects.length ? (
          <div className="today-list">
            {pinnedProjects.map((note) => (
              <div key={note.id} className="today-row">
                <button type="button" onClick={() => open(note)}>
                  {note.title}
                </button>
                <button
                  type="button"
                  aria-label={`Unpin ${note.title}`}
                  onClick={() => togglePin(note.id)}
                >
                  unpin
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Pin an active project to keep it here.</p>
        )}
        <div className="today-project-picker">
          {projects
            .filter((note) => !pins.includes(note.id))
            .map((note) => (
              <button
                key={note.id}
                type="button"
                onClick={() => togglePin(note.id)}
              >
                + {note.title}
              </button>
            ))}
        </div>
      </section>
      <section className="today-section">
        <div className="today-section-head">
          <h2>Recent notes</h2>
          <span>{notes.length}</span>
        </div>
        <div className="today-list">
          {recentNotes(notes).map((note) => (
            <div key={note.id} className="today-row">
              <button type="button" onClick={() => open(note)}>
                {note.title}
              </button>
              <time dateTime={note.modified}>
                {new Date(note.modified).toLocaleDateString()}
              </time>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
