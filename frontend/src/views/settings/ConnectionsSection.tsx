import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CalendarDays, Github, Link2Off, RefreshCw } from "lucide-react";
import {
  getGitHubAutomation,
  getStandupAutomation,
  syncCalendar,
  syncGitHub,
  testCalendar,
  testGitHub,
  updateGitHubAutomation,
  updateStandupAutomation,
  type CalendarTestResult,
  type GitHubAutomation,
  type GitHubSyncResult,
  type GitHubTestResult,
  type StandupAutomation,
} from "../../api/automations";
import { useApp } from "../../context/app-ctx";

function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function localDate(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

export function ConnectionsSection(): ReactNode {
  const { pushToast } = useApp();
  const [automation, setAutomation] = useState<StandupAutomation | null>(null);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [runTime, setRunTime] = useState("08:00");
  const [timezone, setTimezone] = useState(browserTimezone);
  const [calendarEnabled, setCalendarEnabled] = useState(false);
  const [feedUrl, setFeedUrl] = useState("");
  const [calendarName, setCalendarName] = useState("Calendar");
  const [includeInStandup, setIncludeInStandup] = useState(true);
  const [createCaptures, setCreateCaptures] = useState(true);
  const [testResult, setTestResult] = useState<CalendarTestResult | null>(null);
  const [busy, setBusy] = useState<
    "save" | "test" | "sync" | "disconnect" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const actionAbort = useRef<AbortController | null>(null);
  const [github, setGithub] = useState<GitHubAutomation | null>(null);
  const [ghEnabled, setGhEnabled] = useState(false);
  const [ghToken, setGhToken] = useState("");
  const [ghRepos, setGhRepos] = useState("");
  const [ghInterval, setGhInterval] = useState("15");
  const [ghLookback, setGhLookback] = useState("24");
  const [ghIncludeCommits, setGhIncludeCommits] = useState(true);
  const [ghIncludeIssues, setGhIncludeIssues] = useState(true);
  const [ghIncludePRs, setGhIncludePRs] = useState(true);
  const [ghTestResult, setGhTestResult] = useState<GitHubTestResult | null>(
    null,
  );
  const [ghSyncResult, setGhSyncResult] = useState<GitHubSyncResult | null>(
    null,
  );
  const [ghBusy, setGhBusy] = useState<
    "save" | "test" | "sync" | "disconnect" | null
  >(null);
  const [ghError, setGhError] = useState<string | null>(null);
  const ghActionAbort = useRef<AbortController | null>(null);

  const apply = useCallback((next: StandupAutomation) => {
    setAutomation(next);
    setScheduleEnabled(next.schedule.enabled);
    setRunTime(next.schedule.run_time);
    setTimezone(
      next.schedule.timezone === "UTC" && !next.schedule.enabled
        ? browserTimezone()
        : next.schedule.timezone,
    );
    setCalendarEnabled(next.calendar.enabled);
    setCalendarName(next.calendar.name);
    setIncludeInStandup(next.calendar.include_in_standup);
    setCreateCaptures(next.calendar.create_captures);
  }, []);

  const applyGitHub = useCallback((next: GitHubAutomation) => {
    setGithub(next);
    setGhEnabled(next.github.enabled);
    setGhRepos(next.github.repos.join("\n"));
    setGhInterval(String(next.github.interval_minutes));
    setGhLookback(String(next.github.lookback_hours));
    setGhIncludeCommits(next.github.include_commits);
    setGhIncludeIssues(next.github.include_issues);
    setGhIncludePRs(next.github.include_pull_requests);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getStandupAutomation(controller.signal)
      .then(apply)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(
          err instanceof Error
            ? err.message
            : "Connections could not be loaded",
        );
      });
    getGitHubAutomation(controller.signal)
      .then(applyGitHub)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setGhError(
          err instanceof Error
            ? err.message
            : "GitHub connection could not be loaded",
        );
      });
    return () => {
      controller.abort();
      actionAbort.current?.abort();
      actionAbort.current = null;
      ghActionAbort.current?.abort();
      ghActionAbort.current = null;
    };
  }, [apply, applyGitHub]);

  const persist = useCallback(
    async (signal?: AbortSignal): Promise<StandupAutomation> => {
      const next = await updateStandupAutomation({
        schedule: {
          enabled: scheduleEnabled,
          run_time: runTime,
          timezone,
        },
        calendar: {
          enabled: calendarEnabled,
          name: calendarName,
          include_in_standup: includeInStandup,
          create_captures: createCaptures,
          ...(feedUrl.trim() ? { feed_url: feedUrl.trim() } : {}),
        },
      });
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      setFeedUrl("");
      apply(next);
      return next;
    },
    [
      apply,
      calendarEnabled,
      calendarName,
      createCaptures,
      feedUrl,
      includeInStandup,
      runTime,
      scheduleEnabled,
      timezone,
    ],
  );

  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      await persist();
      pushToast({
        icon: "✓",
        agent: "standup",
        body: "Standup automation saved",
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save connection",
      );
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    actionAbort.current?.abort();
    const controller = new AbortController();
    actionAbort.current = controller;
    setBusy("test");
    setError(null);
    try {
      await persist(controller.signal);
      if (controller.signal.aborted) return;
      const result = await testCalendar(localDate(), controller.signal);
      setTestResult(result);
      pushToast({
        icon: "◫",
        agent: "standup",
        body: `Calendar connected — ${result.event_count} event${result.event_count === 1 ? "" : "s"} today`,
      });
    } catch (err) {
      if ((err as DOMException)?.name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Calendar test failed");
      }
    } finally {
      if (actionAbort.current === controller) {
        actionAbort.current = null;
        setBusy(null);
      }
    }
  };

  const sync = async () => {
    actionAbort.current?.abort();
    const controller = new AbortController();
    actionAbort.current = controller;
    setBusy("sync");
    setError(null);
    try {
      await persist(controller.signal);
      if (controller.signal.aborted) return;
      const result = await syncCalendar(localDate(), controller.signal);
      pushToast({
        icon: "↷",
        agent: "standup",
        body: `Calendar sync: ${result.created} new, ${result.deduplicated} already in Inbox`,
      });
    } catch (err) {
      if ((err as DOMException)?.name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Calendar sync failed");
      }
    } finally {
      if (actionAbort.current === controller) {
        actionAbort.current = null;
        setBusy(null);
      }
    }
  };

  const disconnect = async () => {
    setBusy("disconnect");
    setError(null);
    try {
      const next = await updateStandupAutomation({
        calendar: { enabled: false, clear_feed_url: true },
      });
      apply(next);
      setFeedUrl("");
      setTestResult(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not disconnect calendar",
      );
    } finally {
      setBusy(null);
    }
  };

  const persistGitHub = useCallback(
    async (signal?: AbortSignal): Promise<GitHubAutomation> => {
      const next = await updateGitHubAutomation({
        enabled: ghEnabled,
        repos: ghRepos
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        interval_minutes: Math.round(Number(ghInterval)) || 15,
        lookback_hours: Math.round(Number(ghLookback)) || 24,
        include_commits: ghIncludeCommits,
        include_issues: ghIncludeIssues,
        include_pull_requests: ghIncludePRs,
        ...(ghToken.trim() ? { token: ghToken.trim() } : {}),
      });
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      setGhToken("");
      applyGitHub(next);
      return next;
    },
    [
      applyGitHub,
      ghEnabled,
      ghIncludeCommits,
      ghIncludeIssues,
      ghIncludePRs,
      ghInterval,
      ghLookback,
      ghRepos,
      ghToken,
    ],
  );

  const saveGitHub = async () => {
    setGhBusy("save");
    setGhError(null);
    try {
      await persistGitHub();
      pushToast({
        icon: "✓",
        agent: "github",
        body: "GitHub bridge saved",
      });
    } catch (err) {
      setGhError(
        err instanceof Error ? err.message : "Could not save connection",
      );
    } finally {
      setGhBusy(null);
    }
  };

  const testGitHubConnection = async () => {
    ghActionAbort.current?.abort();
    const controller = new AbortController();
    ghActionAbort.current = controller;
    setGhBusy("test");
    setGhError(null);
    try {
      await persistGitHub(controller.signal);
      if (controller.signal.aborted) return;
      const result = await testGitHub(controller.signal);
      setGhTestResult(result);
      const reachable = result.repos.filter((repo) => repo.ok).length;
      pushToast({
        icon: "◫",
        agent: "github",
        body: `GitHub connected — ${reachable} of ${result.repos.length} repos reachable`,
      });
    } catch (err) {
      if ((err as DOMException)?.name !== "AbortError") {
        setGhError(err instanceof Error ? err.message : "GitHub test failed");
      }
    } finally {
      if (ghActionAbort.current === controller) {
        ghActionAbort.current = null;
        setGhBusy(null);
      }
    }
  };

  const syncGitHubNow = async () => {
    ghActionAbort.current?.abort();
    const controller = new AbortController();
    ghActionAbort.current = controller;
    setGhBusy("sync");
    setGhError(null);
    try {
      await persistGitHub(controller.signal);
      if (controller.signal.aborted) return;
      const result = await syncGitHub(controller.signal);
      setGhSyncResult(result);
      pushToast({
        icon: "↷",
        agent: "github",
        body: `GitHub sync: ${result.created} new capture${result.created === 1 ? "" : "s"}, ${result.deduplicated} already in Inbox`,
      });
    } catch (err) {
      if ((err as DOMException)?.name !== "AbortError") {
        setGhError(err instanceof Error ? err.message : "GitHub sync failed");
      }
    } finally {
      if (ghActionAbort.current === controller) {
        ghActionAbort.current = null;
        setGhBusy(null);
      }
    }
  };

  const disconnectGitHub = async () => {
    setGhBusy("disconnect");
    setGhError(null);
    try {
      const next = await updateGitHubAutomation({
        enabled: false,
        clear_token: true,
      });
      applyGitHub(next);
      setGhToken("");
      setGhTestResult(null);
      setGhSyncResult(null);
    } catch (err) {
      setGhError(
        err instanceof Error ? err.message : "Could not disconnect GitHub",
      );
    } finally {
      setGhBusy(null);
    }
  };

  const connected = automation?.calendar.feed_url_set ?? false;
  const status = automation?.status;
  const ghConnected = github?.github.token_set ?? false;
  const ghStatus = github?.status;
  const ghSyncErrors = ghSyncResult?.repos.filter((repo) => repo.error) ?? [];

  return (
    <div className="settings-panel">
      <div className="settings-kicker">Connections</div>
      <h1 className="settings-title">Standup &amp; Calendar</h1>
      <p className="settings-copy">
        Run a daily Standup in your timezone and enrich it from a private,
        read-only iCalendar feed. Calendar events can also become durable Inbox
        jobs.
      </p>

      <section
        className="settings-connection-card"
        aria-labelledby="standup-schedule-title"
      >
        <div className="settings-connection-head">
          <div>
            <h2 id="standup-schedule-title">Daily Standup</h2>
            <p>
              Generates one deduplicated Standup capture for each local day.
            </p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              aria-label="Schedule daily Standup"
              checked={scheduleEnabled}
              onChange={(event) => setScheduleEnabled(event.target.checked)}
              disabled={!automation || busy !== null}
            />
            <span>{scheduleEnabled ? "Scheduled" : "Off"}</span>
          </label>
        </div>
        <div className="settings-field-row">
          <label className="settings-field">
            <span className="settings-field-label">Run time</span>
            <input
              className="input"
              type="time"
              value={runTime}
              onChange={(event) => setRunTime(event.target.value)}
            />
          </label>
          <label className="settings-field">
            <span className="settings-field-label">Timezone</span>
            <input
              className="input"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              placeholder="America/Chicago"
              spellCheck={false}
            />
          </label>
        </div>
        {status?.next_run_at && (
          <p className="settings-connection-status">
            Next run {new Date(status.next_run_at).toLocaleString()}
          </p>
        )}
        {status?.state.last_success_at && (
          <p className="settings-connection-status">
            Last completed{" "}
            {new Date(status.state.last_success_at).toLocaleString()}
          </p>
        )}
        {status?.state.last_error && (
          <p className="settings-test-result fail" role="alert">
            Last run: {status.state.last_error}
          </p>
        )}
      </section>

      <section
        className="settings-connection-card"
        aria-labelledby="calendar-connection-title"
      >
        <div className="settings-connection-head">
          <div>
            <h2 id="calendar-connection-title">
              <CalendarDays size={17} aria-hidden="true" /> Calendar feed
            </h2>
            <p>
              Works with private iCal links from Google, Outlook, Apple, and
              CalDAV.
            </p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              aria-label="Enable calendar connection"
              checked={calendarEnabled}
              onChange={(event) => setCalendarEnabled(event.target.checked)}
              disabled={!automation || busy !== null}
            />
            <span>{calendarEnabled ? "Enabled" : "Off"}</span>
          </label>
        </div>
        <div className="settings-field-row">
          <label className="settings-field">
            <span className="settings-field-label">Calendar name</span>
            <input
              className="input"
              value={calendarName}
              onChange={(event) => setCalendarName(event.target.value)}
            />
          </label>
          <label className="settings-field settings-field-grow">
            <span className="settings-field-label">
              Private iCalendar URL {connected && <em>connected</em>}
            </span>
            <input
              className="input"
              type="url"
              value={feedUrl}
              onChange={(event) => setFeedUrl(event.target.value)}
              placeholder={
                connected
                  ? "Paste a new URL to replace the saved feed"
                  : "webcal://… or https://…"
              }
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </div>
        <label className="settings-toggle-row">
          <input
            type="checkbox"
            checked={includeInStandup}
            onChange={(event) => setIncludeInStandup(event.target.checked)}
          />
          <span>
            <span className="settings-toggle-label">
              Include events in Standup context
            </span>
            <span className="settings-toggle-hint">
              Event text is treated as untrusted source data.
            </span>
          </span>
        </label>
        <label className="settings-toggle-row">
          <input
            type="checkbox"
            checked={createCaptures}
            onChange={(event) => setCreateCaptures(event.target.checked)}
          />
          <span>
            <span className="settings-toggle-label">
              Create Inbox captures for events
            </span>
            <span className="settings-toggle-hint">
              Stable event IDs prevent duplicate jobs.
            </span>
          </span>
        </label>

        <div className="settings-actions">
          <button
            className="btn btn-md btn-active"
            type="button"
            onClick={() => void save()}
            disabled={!automation || busy !== null}
          >
            {busy === "save" ? "Saving…" : "Save"}
          </button>
          <button
            className="btn btn-md"
            type="button"
            onClick={() => void test()}
            disabled={
              !automation || busy !== null || (!connected && !feedUrl.trim())
            }
          >
            {busy === "test" ? "Testing…" : "Test connection"}
          </button>
          <button
            className="btn btn-md"
            type="button"
            onClick={() => void sync()}
            disabled={
              !automation || busy !== null || (!connected && !feedUrl.trim())
            }
          >
            <RefreshCw size={13} aria-hidden="true" />
            {busy === "sync" ? "Syncing…" : "Sync today"}
          </button>
          {connected && (
            <button
              className="btn btn-md"
              type="button"
              onClick={() => void disconnect()}
              disabled={busy !== null}
            >
              <Link2Off size={13} aria-hidden="true" /> Disconnect
            </button>
          )}
        </div>

        {error && (
          <p className="settings-test-result fail" role="alert">
            {error}
          </p>
        )}
        {testResult && (
          <div
            className="settings-calendar-preview"
            role="status"
            aria-live="polite"
          >
            <strong>
              {testResult.event_count} event
              {testResult.event_count === 1 ? "" : "s"} found
            </strong>
            {testResult.events.slice(0, 5).map((event) => (
              <span key={event.external_id}>
                {event.all_day
                  ? "All day"
                  : new Date(event.start).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}{" "}
                · {event.title}
              </span>
            ))}
          </div>
        )}
      </section>

      <section
        className="settings-connection-card"
        aria-labelledby="github-connection-title"
      >
        <div className="settings-connection-head">
          <div>
            <h2 id="github-connection-title">
              <Github size={17} aria-hidden="true" /> GitHub bridge
            </h2>
            <p>
              Poll GitHub repos for new commits, issues, and PRs — activity
              lands in the Inbox for triage.
            </p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              aria-label="Enable GitHub connection"
              checked={ghEnabled}
              onChange={(event) => setGhEnabled(event.target.checked)}
              disabled={
                !github || ghBusy !== null || (!ghEnabled && !ghRepos.trim())
              }
            />
            <span>{ghEnabled ? "Enabled" : "Off"}</span>
          </label>
        </div>
        <label className="settings-field">
          <span className="settings-field-label">
            Personal access token {ghConnected && <em>token saved</em>}
          </span>
          <input
            className="input"
            type="password"
            value={ghToken}
            onChange={(event) => setGhToken(event.target.value)}
            placeholder={
              ghConnected
                ? "ghp_… (leave blank to keep current)"
                : "ghp_… or github_pat_…"
            }
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="settings-field">
          <span className="settings-field-label">
            Repositories — one owner/name per line
          </span>
          <textarea
            className="input"
            rows={3}
            value={ghRepos}
            onChange={(event) => setGhRepos(event.target.value)}
            placeholder={"octocat/hello-world\nyour-org/private-repo"}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <div className="settings-field-row">
          <label className="settings-field">
            <span className="settings-field-label">Poll interval (minutes)</span>
            <input
              className="input"
              type="number"
              min={5}
              max={1440}
              value={ghInterval}
              onChange={(event) => setGhInterval(event.target.value)}
            />
          </label>
          <label className="settings-field">
            <span className="settings-field-label">Lookback (hours)</span>
            <input
              className="input"
              type="number"
              min={1}
              max={720}
              value={ghLookback}
              onChange={(event) => setGhLookback(event.target.value)}
            />
          </label>
        </div>
        <label className="settings-toggle-row">
          <input
            type="checkbox"
            checked={ghIncludeCommits}
            onChange={(event) => setGhIncludeCommits(event.target.checked)}
          />
          <span>
            <span className="settings-toggle-label">Include commits</span>
            <span className="settings-toggle-hint">
              New commits on each repo&apos;s default branch.
            </span>
          </span>
        </label>
        <label className="settings-toggle-row">
          <input
            type="checkbox"
            checked={ghIncludeIssues}
            onChange={(event) => setGhIncludeIssues(event.target.checked)}
          />
          <span>
            <span className="settings-toggle-label">Include issues</span>
            <span className="settings-toggle-hint">
              Issues opened or updated in the lookback window.
            </span>
          </span>
        </label>
        <label className="settings-toggle-row">
          <input
            type="checkbox"
            checked={ghIncludePRs}
            onChange={(event) => setGhIncludePRs(event.target.checked)}
          />
          <span>
            <span className="settings-toggle-label">Include pull requests</span>
            <span className="settings-toggle-hint">
              PRs opened or updated in the lookback window.
            </span>
          </span>
        </label>

        <div className="settings-actions">
          <button
            className="btn btn-md btn-active"
            type="button"
            aria-label="Save GitHub settings"
            onClick={() => void saveGitHub()}
            disabled={!github || ghBusy !== null}
          >
            {ghBusy === "save" ? "Saving…" : "Save"}
          </button>
          <button
            className="btn btn-md"
            type="button"
            aria-label="Test GitHub connection"
            onClick={() => void testGitHubConnection()}
            disabled={!github || ghBusy !== null || !ghRepos.trim()}
          >
            {ghBusy === "test" ? "Testing…" : "Test connection"}
          </button>
          <button
            className="btn btn-md"
            type="button"
            onClick={() => void syncGitHubNow()}
            disabled={!github || ghBusy !== null || !ghRepos.trim()}
          >
            <RefreshCw size={13} aria-hidden="true" />
            {ghBusy === "sync" ? "Syncing…" : "Sync now"}
          </button>
          {ghConnected && (
            <button
              className="btn btn-md"
              type="button"
              aria-label="Disconnect GitHub"
              onClick={() => void disconnectGitHub()}
              disabled={ghBusy !== null}
            >
              <Link2Off size={13} aria-hidden="true" /> Disconnect
            </button>
          )}
        </div>

        {ghError && (
          <p className="settings-test-result fail" role="alert">
            {ghError}
          </p>
        )}
        {ghTestResult && (
          <div
            className="settings-calendar-preview"
            role="status"
            aria-live="polite"
          >
            <strong>
              {ghTestResult.repos.filter((repo) => repo.ok).length} of{" "}
              {ghTestResult.repos.length} repos reachable
            </strong>
            {ghTestResult.repos.map((repo) => (
              <span key={repo.repo}>
                {repo.ok ? "✓" : "✗"} {repo.repo}
                {repo.ok
                  ? repo.description
                    ? ` — ${repo.description}`
                    : ""
                  : ` — ${repo.error}`}
              </span>
            ))}
          </div>
        )}
        {ghSyncErrors.map((repo) => (
          <p key={repo.repo} className="settings-test-result fail" role="alert">
            {repo.repo}: {repo.error}
          </p>
        ))}
        {ghStatus?.last_run && (
          <p className="settings-connection-status">
            Last polled {new Date(ghStatus.last_run).toLocaleString()} —{" "}
            {ghStatus.last_created} new capture
            {ghStatus.last_created === 1 ? "" : "s"}
          </p>
        )}
        {ghStatus?.last_error && (
          <p className="settings-test-result fail" role="alert">
            Last run: {ghStatus.last_error}
          </p>
        )}
      </section>
    </div>
  );
}
