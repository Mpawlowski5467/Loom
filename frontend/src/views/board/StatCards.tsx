import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { BoardStats } from "./boardStats";

const n = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

function until(iso: string, now = Date.now()): string {
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms)) return "";
  if (ms <= 60_000) return "any moment";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `in ${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `in ${h} h` : `in ${Math.round(h / 24)} days`;
}

function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function Stat({
  label,
  value,
  detail,
  valueClass,
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-2xl font-semibold tabular-nums text-foreground",
          valueClass,
        )}
      >
        {value}
      </dd>
      <dd className="text-xs text-muted-foreground">{detail}</dd>
    </div>
  );
}

/** Actions today, Sentinel pass rate, open flags, next scheduled run. */
export function StatCards({ stats }: { stats: BoardStats }) {
  const { sentinel, flags, nextRun } = stats;
  const pass = sentinel.reviewed
    ? Math.round((sentinel.passed / sentinel.reviewed) * 100)
    : null;
  const openFlags = flags.notes + flags.captures;
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat
        label="Actions today"
        value={`${stats.actionsToday}${stats.actionsTodayCapped ? "+" : ""}`}
        detail={`${stats.actionsWeek} in the last week`}
      />
      <Stat
        label="Sentinel pass rate"
        value={pass === null ? "—" : `${pass}%`}
        detail={
          sentinel.reviewed
            ? `${n(sentinel.reviewed, "review")} · ${n(sentinel.warnings, "warning")} · ${sentinel.failed} failed`
            : "No reviews this week"
        }
      />
      <Stat
        label="Open flags"
        value={openFlags}
        valueClass={openFlags > 0 ? "text-warning-foreground" : undefined}
        detail={`${n(flags.notes, "note")} · ${n(flags.captures, "capture")}`}
      />
      <Stat
        label="Next scheduled run"
        value={
          nextRun ? (
            <span className="text-base font-medium">
              Standup {until(nextRun.at)}
            </span>
          ) : (
            "—"
          )
        }
        detail={nextRun ? `at ${clock(nextRun.at)}` : "Nothing scheduled"}
      />
    </dl>
  );
}
