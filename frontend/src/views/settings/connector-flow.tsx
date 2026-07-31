import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Check, Copy, Link2Off, RefreshCw } from "lucide-react";
import { useApp } from "../../context/app-ctx";

/**
 * Shared building blocks for the OAuth connector cards (Google, Microsoft).
 *
 * The guided connect flow has three states, driven entirely by whether
 * credentials are saved and whether a token exists:
 *
 *   setup     — no saved credentials: numbered checklist + credential form +
 *               a disabled sign-in button whose hint explains why.
 *   ready     — credentials saved, no token: credentials collapse to one
 *               muted line (Edit re-expands) and the sign-in button is the
 *               single dominant action.
 *   connected — token present: account line + Disconnect, then the per-
 *               service sections rendered as the shell's children.
 *
 * The shell owns all credential/sign-in state; each card only wires its API
 * calls and supplies service sections. Sign-in polling lives in
 * ``useConnectPoll.ts``.
 */

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

export function CopyChip({ text }: { text: string }): ReactNode {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return; // clipboard unavailable (permissions) — leave the state unchanged
    }
    setCopied(true);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      type="button"
      className="connector-chip"
      onClick={() => void copy()}
      title={copied ? "Copied" : "Copy"}
    >
      <code>{text}</code>
      {copied ? (
        <Check size={11} aria-hidden="true" />
      ) : (
        <Copy size={11} aria-hidden="true" />
      )}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

export function SetupChecklist({ steps }: { steps: ReactNode[] }): ReactNode {
  return (
    <ol className="connector-checklist">
      {steps.map((step, index) => (
        <li key={index}>{step}</li>
      ))}
    </ol>
  );
}

export function CollapsedCredentials({
  clientId,
  onEdit,
}: {
  clientId: string;
  onEdit: () => void;
}): ReactNode {
  const tail = clientId.length > 4 ? `…${clientId.slice(-4)}` : clientId;
  return (
    <p className="settings-connection-status connector-creds-line">
      <span>Client ID {tail} saved</span>
      <button type="button" className="connector-edit" onClick={onEdit}>
        Edit
      </button>
    </p>
  );
}

export function CredentialsForm({
  clientId,
  clientSecret,
  secretSaved,
  clientIdPlaceholder,
  busy,
  onClientIdChange,
  onClientSecretChange,
  onSave,
  onCancel,
}: {
  clientId: string;
  clientSecret: string;
  secretSaved: boolean;
  clientIdPlaceholder: string;
  busy: boolean;
  onClientIdChange: (value: string) => void;
  onClientSecretChange: (value: string) => void;
  onSave: () => void;
  onCancel?: () => void;
}): ReactNode {
  return (
    <>
      <div className="settings-field-row">
        <label className="settings-field">
          <span className="settings-field-label">Client ID</span>
          <input
            className="input"
            value={clientId}
            onChange={(event) => onClientIdChange(event.target.value)}
            placeholder={clientIdPlaceholder}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="settings-field">
          <span className="settings-field-label">
            Client secret {secretSaved && <em>secret saved</em>}
          </span>
          <input
            className="input"
            type="password"
            value={clientSecret}
            onChange={(event) => onClientSecretChange(event.target.value)}
            placeholder={
              secretSaved
                ? "Leave blank to keep current"
                : "OAuth client secret"
            }
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </div>
      <div className="settings-actions">
        <button
          className="btn btn-md btn-active"
          type="button"
          aria-label="Save credentials"
          onClick={onSave}
          disabled={busy}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {onCancel && (
          <button
            className="btn btn-md"
            type="button"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
        )}
      </div>
    </>
  );
}

export function SignInButton({
  label,
  enabled,
  busy,
  hint,
  onClick,
}: {
  label: string;
  enabled: boolean;
  busy: boolean;
  hint?: string;
  onClick: () => void;
}): ReactNode {
  const hintId = useId();
  const showHint = !enabled && !busy && hint;
  return (
    <div className="settings-actions connector-signin">
      <button
        className="btn btn-md btn-active"
        type="button"
        onClick={onClick}
        disabled={!enabled || busy}
        title={showHint ? hint : undefined}
        aria-describedby={showHint ? hintId : undefined}
      >
        {busy ? "Opening…" : label}
      </button>
      {showHint && (
        <p className="settings-connection-status" id={hintId} role="note">
          {hint}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-service section (Calendar, Gmail, Outlook Calendar)
// ---------------------------------------------------------------------------

export interface ServiceSectionValues {
  enabled: boolean;
  intervalMinutes: number;
  lookbackDays: number;
  calendarIds: string[];
}

export interface ServiceTestOutcome {
  ok: boolean;
  account: string;
  error: string;
}

export interface ServiceSyncOutcome {
  created: number;
  deduplicated: number;
  failed: number;
  errorLines: string[];
}

export interface ServiceStatusLine {
  last_run: string;
  last_error: string;
  last_created: number;
}

export function ServiceSection({
  title,
  blurb,
  headingId,
  serviceLabel,
  savedEnabled,
  savedIntervalMinutes,
  savedLookbackDays,
  savedCalendarIdsText,
  status,
  calendarIdsPlaceholder,
  disabled,
  onSave,
  onTest,
  onSync,
}: {
  title: string;
  blurb: string;
  headingId: string;
  serviceLabel: string;
  savedEnabled: boolean;
  savedIntervalMinutes: number;
  savedLookbackDays: number;
  savedCalendarIdsText: string;
  status: ServiceStatusLine | undefined;
  calendarIdsPlaceholder?: string;
  disabled: boolean;
  onSave: (values: ServiceSectionValues) => Promise<void>;
  onTest: () => Promise<ServiceTestOutcome>;
  onSync: () => Promise<ServiceSyncOutcome>;
}): ReactNode {
  const { pushToast } = useApp();
  const [enabled, setEnabled] = useState(savedEnabled);
  const [intervalMinutes, setIntervalMinutes] = useState(
    String(savedIntervalMinutes),
  );
  const [lookbackDays, setLookbackDays] = useState(String(savedLookbackDays));
  const [calendarIds, setCalendarIds] = useState(savedCalendarIdsText);
  const [busy, setBusy] = useState<"save" | "test" | "sync" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ServiceTestOutcome | null>(null);
  const [errorLines, setErrorLines] = useState<string[]>([]);
  const actionAbort = useRef<AbortController | null>(null);

  // Re-sync drafts whenever the saved values change (load, save, connect).
  // Scalar deps only — a fresh object identity every render would clobber
  // the user's in-flight edits.
  useEffect(() => {
    setEnabled(savedEnabled);
    setIntervalMinutes(String(savedIntervalMinutes));
    setLookbackDays(String(savedLookbackDays));
    setCalendarIds(savedCalendarIdsText);
  }, [savedEnabled, savedIntervalMinutes, savedLookbackDays, savedCalendarIdsText]);

  useEffect(
    () => () => {
      actionAbort.current?.abort();
      actionAbort.current = null;
    },
    [],
  );

  const draft = (): ServiceSectionValues => ({
    enabled,
    intervalMinutes: Math.round(Number(intervalMinutes)) || 15,
    lookbackDays: Math.round(Number(lookbackDays)) || 7,
    calendarIds: calendarIds
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  });

  const begin = (
    action: "save" | "test" | "sync",
  ): AbortController => {
    actionAbort.current?.abort();
    const controller = new AbortController();
    actionAbort.current = controller;
    setBusy(action);
    setError(null);
    return controller;
  };

  const end = (controller: AbortController) => {
    if (actionAbort.current === controller) {
      actionAbort.current = null;
      setBusy(null);
    }
  };

  const save = async () => {
    begin("save");
    try {
      await onSave(draft());
      pushToast({ icon: "✓", agent: "connector", body: `${serviceLabel} saved` });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings");
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    const controller = begin("test");
    try {
      // Test runs against the saved config — persist the draft first so the
      // toggle/interval edits apply (same pattern as the iCal card).
      await onSave(draft());
      if (controller.signal.aborted) return;
      const result = await onTest();
      setTestResult(result);
      if (result.ok) {
        pushToast({
          icon: "◫",
          agent: "connector",
          body: `${serviceLabel} connected — ${result.account || "account reachable"}`,
        });
      }
    } catch (err) {
      if ((err as DOMException)?.name !== "AbortError") {
        setError(err instanceof Error ? err.message : `${serviceLabel} test failed`);
      }
    } finally {
      end(controller);
    }
  };

  const sync = async () => {
    const controller = begin("sync");
    try {
      await onSave(draft());
      if (controller.signal.aborted) return;
      const result = await onSync();
      setErrorLines(result.errorLines);
      pushToast({
        icon: "↷",
        agent: "connector",
        body: `${serviceLabel} sync: ${result.created} new capture${result.created === 1 ? "" : "s"}, ${result.deduplicated} already in Inbox${result.failed ? `, ${result.failed} failed` : ""}`,
      });
    } catch (err) {
      if ((err as DOMException)?.name !== "AbortError") {
        setError(err instanceof Error ? err.message : `${serviceLabel} sync failed`);
      }
    } finally {
      end(controller);
    }
  };

  const inactive = disabled || busy !== null;

  return (
    <div className="connector-service">
      <div className="settings-connection-head">
        <div>
          <h2 id={headingId}>{title}</h2>
          <p>{blurb}</p>
        </div>
        <label className="settings-switch">
          <input
            type="checkbox"
            aria-label={`Enable ${serviceLabel}`}
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            disabled={inactive}
          />
          <span>{enabled ? "Enabled" : "Off"}</span>
        </label>
      </div>
      {calendarIdsPlaceholder !== undefined && (
        <label className="settings-field">
          <span className="settings-field-label">
            Calendar IDs — one per line (optional)
          </span>
          <textarea
            className="input"
            rows={2}
            value={calendarIds}
            onChange={(event) => setCalendarIds(event.target.value)}
            placeholder={calendarIdsPlaceholder}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      )}
      <div className="settings-field-row">
        <label className="settings-field">
          <span className="settings-field-label">Poll interval (minutes)</span>
          <input
            className="input"
            type="number"
            min={5}
            max={1440}
            value={intervalMinutes}
            onChange={(event) => setIntervalMinutes(event.target.value)}
          />
        </label>
        <label className="settings-field">
          <span className="settings-field-label">Lookback (days)</span>
          <input
            className="input"
            type="number"
            min={1}
            max={90}
            value={lookbackDays}
            onChange={(event) => setLookbackDays(event.target.value)}
          />
        </label>
      </div>
      <div className="settings-actions">
        <button
          className="btn btn-md btn-active"
          type="button"
          aria-label={`Save ${serviceLabel} settings`}
          onClick={() => void save()}
          disabled={inactive}
        >
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        <button
          className="btn btn-md"
          type="button"
          aria-label={`Test ${serviceLabel} connection`}
          onClick={() => void test()}
          disabled={inactive}
        >
          {busy === "test" ? "Testing…" : "Test connection"}
        </button>
        <button
          className="btn btn-md"
          type="button"
          aria-label={`Sync ${serviceLabel} now`}
          onClick={() => void sync()}
          disabled={inactive}
        >
          <RefreshCw size={13} aria-hidden="true" />
          {busy === "sync" ? "Syncing…" : "Sync now"}
        </button>
      </div>
      {error && (
        <p className="settings-test-result fail" role="alert">
          {error}
        </p>
      )}
      {testResult && (
        <p
          className={`settings-test-result ${testResult.ok ? "ok" : "fail"}`}
          role="status"
        >
          {testResult.ok
            ? `Connected — ${testResult.account || "account reachable"}`
            : testResult.error}
        </p>
      )}
      {errorLines.map((line) => (
        <p key={line} className="settings-test-result fail" role="alert">
          {line}
        </p>
      ))}
      {status?.last_run && (
        <p className="settings-connection-status">
          Last polled {new Date(status.last_run).toLocaleString()} —{" "}
          {status.last_created} new capture
          {status.last_created === 1 ? "" : "s"}
        </p>
      )}
      {status?.last_error && (
        <p className="settings-test-result fail" role="alert">
          Last run: {status.last_error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connector flow shell
// ---------------------------------------------------------------------------

export function ConnectorFlowShell({
  title,
  headingId,
  icon,
  blurb,
  steps,
  signInLabel,
  clientIdPlaceholder,
  savedClientId,
  clientSecretSet,
  connected,
  account,
  loaded,
  onSaveCreds,
  onConnect,
  onDisconnect,
  children,
}: {
  title: string;
  headingId: string;
  icon?: ReactNode;
  blurb: string;
  steps: ReactNode[];
  signInLabel: string;
  clientIdPlaceholder: string;
  savedClientId: string;
  clientSecretSet: boolean;
  connected: boolean;
  account: string;
  loaded: boolean;
  onSaveCreds: (clientId: string, clientSecret: string) => Promise<void>;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  children?: ReactNode;
}): ReactNode {
  const [clientId, setClientId] = useState(savedClientId);
  const [clientSecret, setClientSecret] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"save" | "connect" | "disconnect" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  // Adopt freshly-saved credentials (initial load, save, disconnect) without
  // clobbering an in-flight edit: only re-sync when the saved value changes.
  useEffect(() => {
    setClientId(savedClientId);
  }, [savedClientId]);

  const hasSavedCreds = savedClientId.trim() !== "" && clientSecretSet;
  const credsDirty =
    clientSecret.trim() !== "" || clientId.trim() !== savedClientId.trim();
  // setup: no saved creds (form always). ready: saved + collapsed. Edit
  // re-opens the form; connect stays disabled while drafts diverge.
  const showForm = !hasSavedCreds || editing;
  const signInEnabled =
    loaded && !connected && hasSavedCreds && !credsDirty && busy === null;
  const signInHint = !hasSavedCreds
    ? "Save your client ID and secret above first."
    : credsDirty
      ? "Save your changes first."
      : undefined;

  const saveCreds = async () => {
    setBusy("save");
    setError(null);
    try {
      await onSaveCreds(clientId.trim(), clientSecret.trim());
      setClientSecret("");
      setEditing(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save credentials",
      );
    } finally {
      setBusy(null);
    }
  };

  const cancelEdit = () => {
    setClientId(savedClientId);
    setClientSecret("");
    setEditing(false);
    setError(null);
  };

  const connect = async () => {
    setBusy("connect");
    setError(null);
    try {
      await onConnect();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not start the sign-in",
      );
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy("disconnect");
    setError(null);
    try {
      await onDisconnect();
      setClientSecret("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="settings-connection-head">
        <div>
          <h2 id={headingId}>
            {icon} {title}
          </h2>
          <p>{blurb}</p>
        </div>
      </div>

      {!hasSavedCreds && <SetupChecklist steps={steps} />}

      {showForm ? (
        <CredentialsForm
          clientId={clientId}
          clientSecret={clientSecret}
          secretSaved={clientSecretSet}
          clientIdPlaceholder={clientIdPlaceholder}
          busy={busy !== null}
          onClientIdChange={setClientId}
          onClientSecretChange={setClientSecret}
          onSave={() => void saveCreds()}
          onCancel={hasSavedCreds ? cancelEdit : undefined}
        />
      ) : (
        <CollapsedCredentials
          clientId={savedClientId}
          onEdit={() => setEditing(true)}
        />
      )}

      {!connected && (
        <SignInButton
          label={signInLabel}
          enabled={signInEnabled}
          busy={busy === "connect"}
          hint={signInHint}
          onClick={() => void connect()}
        />
      )}

      {connected && (
        <>
          <p className="settings-connection-status" role="status">
            Connected{account ? ` as ${account}` : ""}
          </p>
          <div className="settings-actions">
            <button
              className="btn btn-md"
              type="button"
              aria-label={`Disconnect ${title}`}
              onClick={() => void disconnect()}
              disabled={busy !== null}
            >
              <Link2Off size={13} aria-hidden="true" />
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
          {children}
        </>
      )}

      {error && (
        <p className="settings-test-result fail" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
