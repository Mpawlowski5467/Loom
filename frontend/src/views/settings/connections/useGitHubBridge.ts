import { useCallback, useEffect, useRef, useState } from "react";
import {
  getGitHubAutomation,
  syncGitHub,
  testGitHub,
  updateGitHubAutomation,
  type GitHubAutomation,
  type GitHubSyncResult,
  type GitHubTestResult,
} from "@/api/automations";
import { useApp } from "@/context/app-ctx";
import { describeApiError } from "@/api/client";

/** The GitHub bridge: saved config, drafts, and Save / Test / Sync. */
export function useGitHubBridge() {
  const { pushToast } = useApp();
  const [github, setGithub] = useState<GitHubAutomation | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [token, setToken] = useState("");
  const [repos, setRepos] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState("15");
  const [lookbackHours, setLookbackHours] = useState("24");
  const [includeCommits, setIncludeCommits] = useState(true);
  const [includeIssues, setIncludeIssues] = useState(true);
  const [includePRs, setIncludePRs] = useState(true);
  const [testResult, setTestResult] = useState<GitHubTestResult | null>(null);
  const [syncResult, setSyncResult] = useState<GitHubSyncResult | null>(null);
  const [busy, setBusy] = useState<
    "save" | "test" | "sync" | "disconnect" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const actionAbort = useRef<AbortController | null>(null);

  const apply = useCallback((next: GitHubAutomation) => {
    setGithub(next);
    setEnabled(next.github.enabled);
    setRepos(next.github.repos.join("\n"));
    setIntervalMinutes(String(next.github.interval_minutes));
    setLookbackHours(String(next.github.lookback_hours));
    setIncludeCommits(next.github.include_commits);
    setIncludeIssues(next.github.include_issues);
    setIncludePRs(next.github.include_pull_requests);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getGitHubAutomation(controller.signal)
      .then(apply)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(
          describeApiError(err, "GitHub connection could not be loaded"),
        );
      });
    return () => {
      controller.abort();
      actionAbort.current?.abort();
      actionAbort.current = null;
    };
  }, [apply]);

  // Sign-in and sign-out only change the connection, so refresh just that:
  // re-applying the whole config would wipe unsaved repo/interval edits.
  const handleSignedIn = useCallback(
    (account: string) => {
      getGitHubAutomation()
        .then(setGithub)
        .catch(() => undefined);
      pushToast({
        icon: "✓",
        agent: "github",
        body: account
          ? `Signed in to GitHub as @${account}`
          : "GitHub connected",
      });
    },
    [pushToast],
  );

  const signOut = useCallback(async () => {
    setGithub(await updateGitHubAutomation({ clear_token: true }));
  }, []);

  const persist = useCallback(
    async (signal?: AbortSignal): Promise<GitHubAutomation> => {
      const next = await updateGitHubAutomation({
        enabled,
        repos: repos
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        interval_minutes: Math.round(Number(intervalMinutes)) || 15,
        lookback_hours: Math.round(Number(lookbackHours)) || 24,
        include_commits: includeCommits,
        include_issues: includeIssues,
        include_pull_requests: includePRs,
        ...(token.trim() ? { token: token.trim() } : {}),
      });
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      setToken("");
      apply(next);
      return next;
    },
    [
      apply,
      enabled,
      includeCommits,
      includeIssues,
      includePRs,
      intervalMinutes,
      lookbackHours,
      repos,
      token,
    ],
  );

  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      await persist();
      pushToast({ icon: "✓", agent: "github", body: "GitHub bridge saved" });
    } catch (err) {
      setError(describeApiError(err, "Could not save connection"));
    } finally {
      setBusy(null);
    }
  };

  /** Save first, then run a check; a newer action aborts this one. */
  const runRepoAction = async (
    action: "test" | "sync",
    work: (signal: AbortSignal) => Promise<void>,
    fallback: string,
  ) => {
    actionAbort.current?.abort();
    const controller = new AbortController();
    actionAbort.current = controller;
    setBusy(action);
    setError(null);
    try {
      await persist(controller.signal);
      if (controller.signal.aborted) return;
      await work(controller.signal);
    } catch (err) {
      if ((err as DOMException)?.name !== "AbortError") {
        setError(err instanceof Error ? err.message : fallback);
      }
    } finally {
      if (actionAbort.current === controller) {
        actionAbort.current = null;
        setBusy(null);
      }
    }
  };

  const test = () =>
    runRepoAction(
      "test",
      async (signal) => {
        const result = await testGitHub(signal);
        setTestResult(result);
        const reachable = result.repos.filter((repo) => repo.ok).length;
        pushToast({
          icon: "◫",
          agent: "github",
          body: `GitHub connected — ${reachable} of ${result.repos.length} repos reachable`,
        });
      },
      "GitHub test failed",
    );

  const sync = () =>
    runRepoAction(
      "sync",
      async (signal) => {
        const result = await syncGitHub(signal);
        setSyncResult(result);
        pushToast({
          icon: "↷",
          agent: "github",
          body: `GitHub sync: ${result.created} new capture${result.created === 1 ? "" : "s"}, ${result.deduplicated} already in Inbox`,
        });
      },
      "GitHub sync failed",
    );

  const disconnect = async () => {
    setBusy("disconnect");
    setError(null);
    try {
      const next = await updateGitHubAutomation({
        enabled: false,
        clear_token: true,
      });
      apply(next);
      setToken("");
      setTestResult(null);
      setSyncResult(null);
    } catch (err) {
      setError(describeApiError(err, "Could not disconnect GitHub"));
    } finally {
      setBusy(null);
    }
  };

  return {
    github,
    enabled,
    setEnabled,
    token,
    setToken,
    repos,
    setRepos,
    intervalMinutes,
    setIntervalMinutes,
    lookbackHours,
    setLookbackHours,
    includeCommits,
    setIncludeCommits,
    includeIssues,
    setIncludeIssues,
    includePRs,
    setIncludePRs,
    testResult,
    syncErrors: syncResult?.repos.filter((repo) => repo.error) ?? [],
    busy,
    error,
    handleSignedIn,
    signOut,
    save,
    test,
    sync,
    disconnect,
  };
}

export type GitHubBridgeState = ReturnType<typeof useGitHubBridge>;
