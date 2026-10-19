import { useCallback, useEffect, useRef, useState } from "react";
import {
  getEmailAutomation,
  syncEmail,
  testEmail,
  updateEmailAutomation,
  type EmailAutomation,
  type EmailTestResult,
} from "@/api/automations";
import { useApp } from "@/context/app-ctx";
import { describeApiError } from "@/api/client";

/** The IMAP email bridge: saved config, drafts, and Save / Test / Sync. */
export function useEmailBridge() {
  const { pushToast } = useApp();
  const [email, setEmail] = useState<EmailAutomation | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("993");
  const [useSsl, setUseSsl] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [folder, setFolder] = useState("INBOX");
  const [intervalMinutes, setIntervalMinutes] = useState("15");
  const [lookbackHours, setLookbackHours] = useState("24");
  const [maxMessages, setMaxMessages] = useState("25");
  const [testResult, setTestResult] = useState<EmailTestResult | null>(null);
  const [busy, setBusy] = useState<
    "save" | "test" | "sync" | "disconnect" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const actionAbort = useRef<AbortController | null>(null);

  const apply = useCallback((next: EmailAutomation) => {
    setEmail(next);
    setEnabled(next.email.enabled);
    setHost(next.email.host);
    setPort(String(next.email.port));
    setUseSsl(next.email.use_ssl);
    setUsername(next.email.username);
    setFolder(next.email.folder);
    setIntervalMinutes(String(next.email.interval_minutes));
    setLookbackHours(String(next.email.lookback_hours));
    setMaxMessages(String(next.email.max_messages_per_poll));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getEmailAutomation(controller.signal)
      .then(apply)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(describeApiError(err, "Email connection could not be loaded"));
      });
    return () => {
      controller.abort();
      actionAbort.current?.abort();
      actionAbort.current = null;
    };
  }, [apply]);

  const persist = useCallback(
    async (signal?: AbortSignal): Promise<EmailAutomation> => {
      const next = await updateEmailAutomation({
        enabled,
        host: host.trim(),
        port: Math.round(Number(port)) || 993,
        use_ssl: useSsl,
        username: username.trim(),
        folder: folder.trim() || "INBOX",
        interval_minutes: Math.round(Number(intervalMinutes)) || 15,
        lookback_hours: Math.round(Number(lookbackHours)) || 24,
        max_messages_per_poll: Math.round(Number(maxMessages)) || 25,
        ...(password.trim() ? { password: password.trim() } : {}),
      });
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      setPassword("");
      apply(next);
      return next;
    },
    [
      apply,
      enabled,
      folder,
      host,
      intervalMinutes,
      lookbackHours,
      maxMessages,
      password,
      port,
      useSsl,
      username,
    ],
  );

  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      await persist();
      pushToast({ icon: "✓", agent: "email", body: "Email bridge saved" });
    } catch (err) {
      setError(describeApiError(err, "Could not save connection"));
    } finally {
      setBusy(null);
    }
  };

  /** Save first, then reach the mailbox; a newer action aborts this one. */
  const runMailboxAction = async (
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
    runMailboxAction(
      "test",
      async (signal) => {
        const result = await testEmail(signal);
        setTestResult(result);
        if (result.ok) {
          pushToast({
            icon: "◫",
            agent: "email",
            body: `Email connected — ${result.folder} has ${result.messages} message${result.messages === 1 ? "" : "s"}`,
          });
        }
      },
      "Email test failed",
    );

  const sync = () =>
    runMailboxAction(
      "sync",
      async (signal) => {
        const result = await syncEmail(signal);
        pushToast({
          icon: "↷",
          agent: "email",
          body: `Email sync: ${result.created} new capture${result.created === 1 ? "" : "s"}, ${result.deduplicated} already in Inbox`,
        });
      },
      "Email sync failed",
    );

  const disconnect = async () => {
    setBusy("disconnect");
    setError(null);
    try {
      const next = await updateEmailAutomation({
        enabled: false,
        clear_password: true,
      });
      apply(next);
      setPassword("");
      setTestResult(null);
    } catch (err) {
      setError(describeApiError(err, "Could not disconnect email"));
    } finally {
      setBusy(null);
    }
  };

  const passwordSaved = email?.email.password_set ?? false;
  return {
    email,
    enabled,
    setEnabled,
    host,
    setHost,
    port,
    setPort,
    useSsl,
    setUseSsl,
    username,
    setUsername,
    password,
    setPassword,
    passwordSaved,
    folder,
    setFolder,
    intervalMinutes,
    setIntervalMinutes,
    lookbackHours,
    setLookbackHours,
    maxMessages,
    setMaxMessages,
    // Host, username and a password (saved or typed) are needed to connect.
    ready:
      host.trim() !== "" &&
      username.trim() !== "" &&
      (passwordSaved || password.trim() !== ""),
    testResult,
    busy,
    error,
    save,
    test,
    sync,
    disconnect,
  };
}

export type EmailBridgeState = ReturnType<typeof useEmailBridge>;
