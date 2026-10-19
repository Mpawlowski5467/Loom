import { useMemo } from "react";
import { cn } from "@/lib/utils";

const PRE =
  "max-h-[400px] overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-secondary-foreground";

const ROW = {
  same: "",
  added: "bg-ok text-ok-foreground",
  removed: "bg-danger-foreground/10 text-danger-foreground",
} as const;

/** A bounded line diff; very large documents use a complete side-by-side view. */
export function TextDiff({ before, after }: { before: string; after: string }) {
  const rows = useMemo(() => {
    const a = before.split("\n"),
      b = after.split("\n");
    if (a.length * b.length > 250_000) return null;
    const table = Array.from(
      { length: a.length + 1 },
      () => new Uint32Array(b.length + 1),
    );
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--)
        table[i]![j] =
          a[i] === b[j]
            ? table[i + 1]![j + 1]! + 1
            : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    const lines: Array<{ kind: "same" | "removed" | "added"; text: string }> =
      [];
    let i = 0,
      j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        lines.push({ kind: "same", text: a[i++]! });
        j++;
      } else if (
        j < b.length &&
        (i === a.length || table[i]![j + 1]! >= table[i + 1]![j]!)
      )
        lines.push({ kind: "added", text: b[j++]! });
      else lines.push({ kind: "removed", text: a[i++]! });
    }
    return lines;
  }, [before, after]);
  if (!rows)
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <section className="flex min-w-0 flex-col gap-1.5">
          <h4 className="text-xs font-medium text-muted-foreground">Before</h4>
          <pre className={PRE}>{before}</pre>
        </section>
        <section className="flex min-w-0 flex-col gap-1.5">
          <h4 className="text-xs font-medium text-muted-foreground">After</h4>
          <pre className={PRE}>{after}</pre>
        </section>
      </div>
    );
  return (
    <pre className={PRE} aria-label="Changes: minus removed, plus added">
      {rows.map((row, i) => (
        <span key={i} className={cn("block", ROW[row.kind])}>
          {row.kind === "added" ? "+ " : row.kind === "removed" ? "− " : "  "}
          {row.text}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}
