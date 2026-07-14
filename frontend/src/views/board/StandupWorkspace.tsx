import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CalendarDays, Inbox, Loader2, Play, X } from "lucide-react";
import {
  generateStandup,
  getStandupAutomation,
  syncCalendar,
  type StandupAutomation,
  type StandupResult,
} from "../../api/automations";
import { useFocusTrap } from "../../components/useFocusTrap";
import { AgentBlob } from "../../components/primitives/AgentBlob";
import { useApp } from "../../context/app-ctx";
import { Markdown } from "../../editor/Markdown";

interface StandupWorkspaceProps {
  onClose: () => void;
}

function today(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

export function StandupWorkspace({
  onClose,
}: StandupWorkspaceProps): ReactNode {
  const { pushToast, selectCapture, setTab } = useApp();
  const [date, setDate] = useState(today);
  const [automation, setAutomation] = useState<StandupAutomation | null>(null);
  const [result, setResult] = useState<StandupResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runAbort = useRef<AbortController | null>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>({ onEscape: onClose });

  useEffect(() => {
    const controller = new AbortController();
    getStandupAutomation(controller.signal)
      .then(setAutomation)
      .catch(() => {
        // The run endpoint remains useful when automation status is unavailable.
      });
    return () => {
      controller.abort();
      runAbort.current?.abort();
      runAbort.current = null;
    };
  }, []);

  const run = async () => {
    if (running) return;
    runAbort.current?.abort();
    const controller = new AbortController();
    runAbort.current = controller;
    setRunning(true);
    setError(null);
    try {
      const calendar = automation?.calendar;
      if (
        calendar?.enabled &&
        calendar.feed_url_set &&
        calendar.create_captures
      ) {
        await syncCalendar(date, controller.signal);
      }
      const next = await generateStandup(date, controller.signal);
      setResult(next);
      pushToast({
        icon: "☀",
        agent: "standup",
        body: next.recap
          ? `Standup for ${next.date} saved to Inbox`
          : `No activity found for ${next.date}`,
      });
    } catch (caught) {
      if ((caught as DOMException)?.name !== "AbortError") {
        setError(
          caught instanceof Error ? caught.message : "Standup could not run",
        );
      }
    } finally {
      if (runAbort.current === controller) {
        runAbort.current = null;
        setRunning(false);
      }
    }
  };

  const openInbox = () => {
    if (result?.capture_id) selectCapture(result.capture_id);
    setTab("inbox");
    onClose();
  };

  const connected =
    automation?.calendar.enabled && automation.calendar.feed_url_set;

  return (
    <div
      className="settings-modal-backdrop standup-workspace-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="settings-modal standup-workspace"
        role="dialog"
        aria-modal="true"
        aria-labelledby="standup-workspace-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="researcher-workspace-head">
          <AgentBlob
            agent="standup"
            state={running ? "running" : "idle"}
            size={40}
          />
          <div>
            <h2 id="standup-workspace-title">Standup</h2>
            <p>Review one day of vault activity and calendar context.</p>
          </div>
          <button
            type="button"
            className="icon-btn researcher-workspace-close"
            onClick={onClose}
            aria-label="Close Standup workspace"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="standup-controls">
          <label>
            <span>Date</span>
            <input
              className="input"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              disabled={running}
            />
          </label>
          <button
            className="btn btn-md btn-active"
            type="button"
            onClick={() => void run()}
            disabled={running || !date}
          >
            {running ? (
              <Loader2 size={14} className="spin" aria-hidden="true" />
            ) : (
              <Play size={14} aria-hidden="true" />
            )}
            {running ? "Generating…" : "Generate Standup"}
          </button>
        </div>

        <div className="standup-automation-strip">
          <span>
            {automation?.schedule.enabled
              ? `Scheduled ${automation.schedule.run_time} · ${automation.schedule.timezone}`
              : "Daily schedule is off"}
          </span>
          <span className={connected ? "is-connected" : undefined}>
            <CalendarDays size={13} aria-hidden="true" />
            {connected
              ? `${automation?.calendar.name} connected`
              : "No calendar connected"}
          </span>
        </div>

        <main className="standup-result" aria-live="polite" aria-busy={running}>
          {running && (
            <div className="standup-empty" role="status">
              <Loader2 size={18} className="spin" aria-hidden="true" />
              Reading activity, notes, and calendar events…
            </div>
          )}
          {!running && !result && (
            <div className="standup-empty">
              <CalendarDays size={24} aria-hidden="true" />
              <strong>Choose a date to prepare its recap.</strong>
              <span>
                The result is saved as one deduplicated Inbox capture.
              </span>
            </div>
          )}
          {!running && result && result.recap && (
            <article className="standup-recap">
              <div className="standup-result-meta">
                <span>{result.notes_modified} notes touched</span>
                <span>{result.calendar_events} calendar events</span>
              </div>
              {result.calendar_error && (
                <div className="standup-warning" role="alert">
                  Calendar: {result.calendar_error}
                </div>
              )}
              <Markdown source={result.recap} bodyClass="researcher-answer" />
              <button
                className="btn btn-md btn-purple"
                type="button"
                onClick={openInbox}
              >
                <Inbox size={14} aria-hidden="true" /> Open in Inbox
              </button>
            </article>
          )}
          {!running && result && !result.recap && (
            <div className="standup-empty">
              <strong>No activity found for {result.date}.</strong>
              <span>No capture was created.</span>
              {result.calendar_error && (
                <span className="standup-warning" role="alert">
                  Calendar: {result.calendar_error}
                </span>
              )}
            </div>
          )}
        </main>
        {error && (
          <div className="researcher-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
