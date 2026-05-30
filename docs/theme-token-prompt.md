# Prompt for Claude Design — generate full Loom theme token blocks

Copy everything in the fenced block below into Claude. It already contains your 9
base palettes; Claude will expand each into a complete `.theme-<name>` block that
drops straight into `frontend/src/styles/tokens.css`.

---

````
You are generating CSS custom-property blocks for a design system called Loom.

I will give you 9 themes, each with ~15 BASE colors. For EACH theme, output a
complete CSS block that also includes ~27 DERIVED tokens, computed with the EXACT
rules below. Do not invent values — derive them mechanically so every theme is
internally consistent. Output ONLY the CSS (no prose), one block per theme.

## Output format (per theme)

Use a `.theme-<name>` class selector (NOT `:root[data-theme]`). For the FIRST
theme (paper) only, prefix the selector with `:root,` so it is also the default,
like: `:root,\n.theme-paper {`. All others are just `.theme-<name> {`.

## Required tokens, in this order, per block

```
.theme-<name> {
  /* Surfaces */
  --bg-base: <base>;
  --bg-surface: <surface>;
  --bg-elevated: <elevated>;

  /* Ink */
  --ink: <ink>;
  --ink-2: <ink-2>;
  --ink-3: <ink-3>;
  --ink-rgb: <R, G, B of --ink>;

  /* Hairlines */
  --rule: rgba(var(--ink-rgb), <RULE>);
  --rule-2: rgba(var(--ink-rgb), <RULE2>);

  /* Duotone — agent */
  --agent: <agent>;
  --agent-rgb: <R, G, B of --agent>;
  --agent-bg: rgba(var(--agent-rgb), <ACCENT_BG>);
  --agent-line: rgba(var(--agent-rgb), <ACCENT_LINE>);
  --agent-line-fade: rgba(var(--agent-rgb), 0);

  /* Duotone — you */
  --you: <you>;
  --you-rgb: <R, G, B of --you>;
  --you-bg: rgba(var(--you-rgb), <ACCENT_BG>);
  --you-line: rgba(var(--you-rgb), <YOU_LINE>);

  /* Status */
  --green: <node-topic>;        /* reuse the theme's --node-topic value */
  --green-bg: rgba(<R,G,B of --node-topic>, <GREEN_BG>);
  --red: <you>;                 /* reuse the theme's --you value */

  /* Node-type swatches (given) */
  --node-project: <node-project>;
  --node-topic: <node-topic>;
  --node-people: <node-people>;
  --node-daily: <node-daily>;
  --node-capture: <node-capture>;
  --node-custom: <node-custom>;

  /* Graph tokens (read by sigma at paint time) */
  --label-color: var(--ink-2);
  --edge-color: rgba(var(--ink-rgb), <EDGE>);
  --edge-color-hover: rgba(var(--you-rgb), <EDGE_HOVER>);
  --edge-color-faint: rgba(var(--ink-rgb), <EDGE_FAINT>);
  --node-dimmed: rgba(var(--ink-rgb), 0.1);

  /* Surface elevation shadow */
  --shadow-elev: <SHADOW>;

  /* Static — identical in every theme, copy verbatim */
  --font: "Inter", system-ui, -apple-system, sans-serif;
  --serif: "Fraunces", "Iowan Old Style", Georgia, serif;
  --mono: "JetBrains Mono", "SF Mono", Menlo, monospace;
  --r-sm: 4px;
  --r-md: 6px;
  --r-lg: 10px;
  --ease: cubic-bezier(0.2, 0.7, 0.3, 1);
}
```

## Derivation constants

`--ink-rgb`, `--agent-rgb`, `--you-rgb` = the decimal R, G, B of `--ink`,
`--agent`, `--you` (e.g. `#2d4a7c` → `45, 74, 124`).

`--green-bg` uses the decimal R, G, B of `--node-topic`, not a var.

Pick the opacity constants by the theme's mode (LIGHT or DARK, given per theme):

| Constant      | LIGHT | DARK |
|---------------|-------|------|
| RULE          | 0.08  | 0.07 |
| RULE2         | 0.18  | 0.18 |
| ACCENT_BG     | 0.08  | 0.11 |
| ACCENT_LINE   | 0.35  | 0.42 |
| YOU_LINE      | 0.40  | 0.45 |
| GREEN_BG      | 0.12  | 0.14 |
| EDGE          | 0.18  | 0.16 |
| EDGE_HOVER    | 0.55  | 0.60 |
| EDGE_FAINT    | 0.05  | 0.06 |

`--shadow-elev`:
- LIGHT → `rgba(var(--ink-rgb), 0.1)`
- DARK  → `rgba(0, 0, 0, 0.55)`

## The 9 themes (name · mode · base colors)

LIGHT — paper        bg #f5f1e8 / #ede8da / #e3dcca · ink #1a1815 / #5c5851 / #8c877d · agent #2d4a7c · you #a83a2c · nodes project #2d4a7c topic #4a6b3a people #6b3a6b daily #8c877d capture #a8722a custom #2d6b6b
LIGHT — slate        bg #ecece6 / #e0e0d9 / #d2d2c8 · ink #1a1d20 / #555a60 / #8a8f96 · agent #1e3a8a · you #c2410c · nodes project #1e3a8a topic #15803d people #7c3aed daily #64748b capture #c2410c custom #0e7490
LIGHT — foundry      bg #f4efe3 / #ebe3d0 / #e0d6bf · ink #211c15 / #6b6359 / #928b7e · agent #2f4a78 · you #b0432e · nodes project #2f4a78 topic #4f6b35 people #7a3f6b daily #8d8678 capture #b06a28 custom #2f6b66
LIGHT — dune         bg #ece4d0 / #dcd1b4 / #cec1a0 · ink #2a2618 / #6b6450 / #928b73 · agent #2b5654 · you #a8521f · nodes project #2b5654 topic #6f7b30 people #7a3f6b daily #8a8268 capture #a8521f custom #9a6a2a
DARK  — carbon       bg #0a0a0a / #161616 / #1f1f1f · ink #ededed / #9a9a9a / #5e5e5e · agent #7eed90 · you #f06c9b · nodes project #7eed90 topic #9becff people #f06c9b daily #9a9a9a capture #f0d56c custom #6c9cf0
DARK  — lagoon       bg #0d1f24 / #142e36 / #1d404a · ink #e8f0f0 / #94abad / #5d7376 · agent #ff8a7a · you #f5d56b · nodes project #ff8a7a topic #7ddcb4 people #c89cff daily #7a9396 capture #f5d56b custom #5dd3d9
DARK  — obsidian     bg #0a0a0c / #141418 / #1f1f25 · ink #f0f0ee / #9a9aa0 / #62626a · agent #5fb8ff · you #ff8a3a · nodes project #8ef06a topic #5fb8ff people #ff5fd1 daily #8a8a92 capture #ff8a3a custom #b07bff
DARK  — ember        bg #1a120e / #271811 / #33211a · ink #f0e6d8 / #b39c8a / #6e5d50 · agent #f0a83a · you #e664a4 · nodes project #f0a83a topic #b3d164 people #e664a4 daily #a08a76 capture #f07840 custom #5dc7c4
DARK  — mulberry     bg #1a1222 / #261934 / #332343 · ink #f0e6f5 / #b29bc4 / #776588 · agent #b89dff · you #ff8da8 · nodes project #b89dff topic #74e8c0 people #ff8da8 daily #9a8aaa capture #f5b876 custom #7ec7e5

Output the 9 complete `.theme-*` blocks now, in the order listed.
````

---

## When you paste the result back

Hand the CSS to me (Claude Code) and I'll: (1) drop it into `tokens.css`,
(2) update `theme/themes.ts` `THEME_META` to the new 9 names + light/dark modes,
(3) wire the theme picker, and (4) verify the graph still reads the tokens.
