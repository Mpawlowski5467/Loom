import { cn } from "@/lib/utils";
import { isToday, weekday } from "./threadDates";

const BAR_MAX = 88;

interface ActivityChartProps {
  days: readonly { date: string; count: number }[];
  /** The changelog window was full; there may be more. */
  capped: boolean;
}

/** Agent actions per day this week; today in the brand color. */
export function ActivityChart({ days, capped }: ActivityChartProps) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((sum, d) => sum + d.count, 0);
  return (
    <section aria-labelledby="activity-title" className="flex flex-col gap-3">
      <header className="flex items-baseline justify-between gap-2">
        <h2 id="activity-title" className="text-sm font-medium text-foreground">
          Agent actions
        </h2>
        <span className="font-mono text-xs text-muted-foreground">
          {total}
          {capped && "+"} this week
        </span>
      </header>
      <ol aria-label="Actions per day" className="flex items-end gap-1.5">
        {days.map((d) => {
          const today = isToday(d.date);
          const height = d.count
            ? Math.max(3, Math.round((d.count / max) * BAR_MAX))
            : 2;
          return (
            <li
              key={d.date}
              className="flex flex-1 flex-col items-center gap-1.5"
            >
              <span className="sr-only">
                {weekday(d.date, "long")}
                {today && " (today)"}: {d.count}{" "}
                {d.count === 1 ? "action" : "actions"}
              </span>
              <span
                aria-hidden="true"
                title={`${d.count}`}
                className={cn(
                  "block w-full max-w-8 rounded-sm",
                  today ? "bg-brand" : "bg-border-strong",
                )}
                style={{ height }}
              />
              <span
                aria-hidden="true"
                className={cn(
                  "font-mono text-[10px]",
                  today ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {weekday(d.date, "short").slice(0, 2)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
