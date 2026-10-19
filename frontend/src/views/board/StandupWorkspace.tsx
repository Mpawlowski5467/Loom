import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CalendarDays, Loader2, Play } from "lucide-react";
import {
  generateStandup,
  getStandupAutomation,
  syncCalendar,
  type StandupAutomation,
  type StandupResult,
} from "../../api/automations";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApp } from "@/context/app-ctx";
import { StandupResultView } from "./StandupResultView";
import { cn } from "@/lib/utils";

interface StandupWorkspaceProps {
  onClose: () => void;
}

/** Today as YYYY-MM-DD in local time (the en-CA date format). */
const today = (): string => new Date().toLocaleDateString("en-CA");

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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-2xl"
      >
        <header className="flex items-center gap-3 border-b border-border px-5 py-4">
          <AgentAvatar actor="standup" size="lg" />
          <div className="min-w-0 flex-1">
            <DialogTitle>Standup</DialogTitle>
            <DialogDescription>
              Review one day of vault activity and calendar context.
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close Standup workspace"
          >
            Close
          </Button>
        </header>
        <div className="flex flex-wrap items-end gap-3 px-5 py-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="standup-date">Date</Label>
            <Input
              id="standup-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              disabled={running}
              className="w-44"
            />
          </div>
          <Button onClick={() => void run()} disabled={running || !date}>
            {running ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <Play aria-hidden="true" />
            )}
            {running ? "Generating…" : "Generate Standup"}
          </Button>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-y border-border bg-muted px-5 py-2 text-xs text-muted-foreground">
          <span>
            {automation?.schedule.enabled
              ? `Scheduled ${automation.schedule.run_time} · ${automation.schedule.timezone}`
              : "Daily schedule is off"}
          </span>
          <span
            className={cn(
              "flex items-center gap-1.5",
              connected && "text-ok-foreground",
            )}
          >
            <CalendarDays aria-hidden="true" className="size-3.5" />
            {connected
              ? `${automation?.calendar.name} connected`
              : "No calendar connected"}
          </span>
        </div>
        <div
          className="min-h-48 flex-1 overflow-y-auto px-5 py-4"
          aria-live="polite"
          aria-busy={running}
        >
          {running && (
            <p
              role="status"
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              Reading activity, notes, and calendar events…
            </p>
          )}
          {!running && (
            <StandupResultView result={result} onOpenInbox={openInbox} />
          )}
        </div>
        {error && (
          <p
            role="alert"
            className="border-t border-border px-5 py-3 text-sm text-danger-foreground"
          >
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
