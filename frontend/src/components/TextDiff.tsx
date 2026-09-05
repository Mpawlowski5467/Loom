import { useMemo } from "react";
import "../styles/components/revisions.css";

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
      <div className="revision-columns">
        <section>
          <h4>Before</h4>
          <pre>{before}</pre>
        </section>
        <section>
          <h4>After</h4>
          <pre>{after}</pre>
        </section>
      </div>
    );
  return (
    <pre className="text-diff" aria-label="Changes: minus removed, plus added">
      {rows.map((row, i) => (
        <span key={i} className={`diff-${row.kind}`}>
          {row.kind === "added" ? "+ " : row.kind === "removed" ? "− " : "  "}
          {row.text}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}
