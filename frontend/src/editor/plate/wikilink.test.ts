import type { TElement } from "platejs";
import { createPlateEditor } from "platejs/react";
import { describe, expect, it } from "vitest";
import { notePlugins } from "./plugins";
import { WIKILINK, WIKILINK_INPUT } from "./wikilink";

function editorWith(text: string) {
  const editor = createPlateEditor({
    plugins: notePlugins,
    value: [{ type: "p", children: [{ text }] }],
  });
  editor.tf.select({ path: [0, 0], offset: text.length });
  return editor;
}

const inlines = (editor: ReturnType<typeof editorWith>) =>
  (editor.children[0] as TElement).children as TElement[];

describe("wikilink typing", () => {
  it("opens the note picker on [[", () => {
    const editor = editorWith("See ");
    editor.tf.insertText("[");
    editor.tf.insertText("[");
    const nodes = inlines(editor);
    expect(nodes.some((n) => n.type === WIKILINK_INPUT)).toBe(true);
    expect(editor.api.string([0])).toBe("See ");
  });

  it("turns a hand-typed [[link]] into a chip on the closing bracket", () => {
    const editor = editorWith("See [[latency-budget|budget]");
    editor.tf.insertText("]");
    const link = inlines(editor).find((n) => n.type === WIKILINK);
    expect(link).toMatchObject({ target: "latency-budget", alias: "budget" });
    expect(editor.api.string([0])).toBe("See ");
  });

  it("leaves a single [ and code alone", () => {
    const editor = editorWith("a ");
    editor.tf.insertText("[");
    expect(editor.api.string([0])).toBe("a [");
    const code = createPlateEditor({
      plugins: notePlugins,
      value: [{ type: "p", children: [{ text: "x[", code: true }] }],
    });
    code.tf.select({ path: [0, 0], offset: 2 });
    code.tf.insertText("[");
    expect(code.api.string([0])).toBe("x[[");
  });
});
