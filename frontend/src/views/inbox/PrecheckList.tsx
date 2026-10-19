import { CircleCheck, CircleX, TriangleAlert } from "lucide-react";
import type { PrecheckItem } from "@/api/proposals";
import { cn } from "@/lib/utils";

const ICON = { pass: CircleCheck, warn: TriangleAlert, fail: CircleX };
const TONE = {
  pass: "text-ok-foreground",
  warn: "text-warning-foreground",
  fail: "text-danger-foreground",
};

/** Sentinel's pre-check, or our estimate of it before filing. */
export function PrecheckList({
  items,
  estimated,
}: {
  items: PrecheckItem[];
  estimated: boolean;
}) {
  return (
    <section aria-labelledby="precheck-h" className="flex flex-col gap-2">
      <h4
        id="precheck-h"
        className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase"
      >
        Sentinel pre-check
      </h4>
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => {
          const Icon = ICON[item.status];
          return (
            <li key={item.rule} className="flex items-start gap-2 text-sm">
              <Icon
                aria-hidden="true"
                className={cn("mt-0.5 size-4 shrink-0", TONE[item.status])}
              />
              <span>
                <span className="font-medium text-foreground">{item.rule}</span>
                <span className="sr-only"> ({item.status})</span>
                <span className="text-secondary-foreground">
                  {" "}
                  — {item.message}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {estimated && (
        <p className="text-[11px] text-muted-foreground">
          Checked in the browser from Weaver's proposal. Sentinel runs its full
          validation when you file.
        </p>
      )}
    </section>
  );
}
