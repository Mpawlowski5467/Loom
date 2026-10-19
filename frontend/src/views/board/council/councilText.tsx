/** Council text with `[[wikilinks]]` shown as chips (no navigation). */
export function CouncilText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[\[[^\]]+\]\])/g).map((part, i) =>
        part.startsWith("[[") && part.endsWith("]]") ? (
          <span
            key={i}
            className="rounded-sm bg-chip px-1 text-chip-foreground"
          >
            {part.slice(2, -2).split("|")[0]}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
