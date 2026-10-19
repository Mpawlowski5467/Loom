import { highlightParts } from "./match";

/** `text` with every query term marked. */
export function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, i) =>
        part.hit ? (
          <mark key={i} className="rounded-[2px] bg-brand/25 text-foreground">
            {part.text}
          </mark>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
