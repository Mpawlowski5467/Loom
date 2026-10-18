/**
 * Markdown the editor must never rewrite on open. Mixes the constructs vault
 * notes use with deliberately unusual formatting (alternate bullets, setext
 * headings, escaped characters, trailing spaces) that a normalising
 * serializer would change. Fictional placeholder content.
 */
export const CORPUS: Record<string, string> = {
  basics: `Intro paragraph with **bold**, *italic*, ~~struck~~ and \`code\`.

## Section

Second paragraph links [[cache-plan-v2]] and [[latency-budget|the budget]].
`,
  alternateSyntax: `Setext heading
==============

* star bullet
* another one

1) paren list
2) second

__underscore bold__ and _underscore em_
***

Hard break with two spaces  
next line.`,
  tasksAndTables: `- [ ] open task
- [x] done task

| Metric | Target |
|:-------|-------:|
| p95    | 120 ms |
| lag    |   2 s  |
`,
  codeAndQuotes: `> A quote that spans
> two lines.

\`\`\`ts
const x = "[[not a link]]";
\`\`\`

    indented code block

Term with escaped \\* star and a \\[bracket\\].
`,
  referencesAndHtml: `See [the guide][guide] and <kbd>Cmd</kbd>.

<details>
<summary>More</summary>

Hidden text.
</details>

[guide]: https://example.org/guide "Guide"
`,
  wikilinkForms: `[[Plain]] · [[folder/note]] · [[note#Heading]] · [[note#Heading|Alias]]
`,
  irregularWhitespace: `

First after blank lines.



After several blank lines.
`,
  empty: ``,
};
