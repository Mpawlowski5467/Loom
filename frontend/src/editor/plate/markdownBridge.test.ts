import type { TElement } from "platejs";
import { createPlateEditor } from "platejs/react";
import { describe, expect, it } from "vitest";
import { notes as seedNotes } from "@/data/notes";
import { CORPUS } from "@/editor/markdown/__fixtures__/corpus";
import { captureBaseline, loadNote, saveNote } from "./markdownBridge";
import { notePlugins } from "./plugins";

function open(markdown: string) {
  const editor = createPlateEditor({ plugins: notePlugins });
  const loaded = loadNote(editor, markdown);
  editor.tf.setValue(loaded.value);
  const baseline = captureBaseline(editor.children);
  return { editor, loaded, save: () => saveNote(editor, loaded, baseline) };
}

/** Index of the first top-level node whose text includes `needle`. */
function blockWith(editor: ReturnType<typeof open>["editor"], needle: string) {
  const i = editor.children.findIndex((n) =>
    editor.api.string([editor.children.indexOf(n)]).includes(needle),
  );
  if (i < 0) throw new Error(`no block containing ${needle}`);
  return i;
}

describe("lossless markdown bridge", () => {
  it.each(Object.entries(CORPUS))("never rewrites %s on open", (_, md) => {
    expect(open(md).save()).toBe(md);
  });

  it.each(seedNotes.map((n) => [n.title, n.body] as const))(
    "never rewrites the demo note %s",
    (_, body) => {
      expect(open(body).save()).toBe(body);
    },
  );

  it("reformats only the edited block", () => {
    const md = CORPUS.alternateSyntax!;
    const { editor, save } = open(md);
    const i = blockWith(editor, "Hard break");
    editor.tf.insertText("Edited. ", { at: { path: [i, 0], offset: 0 } });
    const out = save();
    // Untouched blocks keep their unusual syntax byte for byte.
    expect(out).toContain("Setext heading\n==============");
    expect(out).toContain("* star bullet\n* another one");
    expect(out).toContain("1) paren list");
    expect(out).toContain("__underscore bold__ and _underscore em_");
    expect(out).toContain("Edited. Hard break");
  });

  it("returns to the exact source when an edit is undone", () => {
    const md = CORPUS.basics!;
    const { editor, save } = open(md);
    editor.tf.insertText("X", { at: { path: [0, 0], offset: 0 } });
    expect(save()).not.toBe(md);
    editor.tf.delete({ at: { path: [0, 0], offset: 0 }, distance: 1 });
    expect(save()).toBe(md);
  });

  it("turns wikilinks into chips and writes them back", () => {
    const { editor, save } = open(
      "Link [[cache-plan-v2]] and [[latency-budget|budget]].\n",
    );
    const links = (editor.children[0] as TElement).children.filter(
      (c) => (c as TElement).type === "wikilink",
    );
    expect(links).toMatchObject([
      { target: "cache-plan-v2" },
      { target: "latency-budget", alias: "budget" },
    ]);
    editor.tf.insertText("See: ", { at: { path: [0, 0], offset: 0 } });
    expect(save()).toBe(
      "See: Link [[cache-plan-v2]] and [[latency-budget|budget]].\n",
    );
  });

  it("keeps task lists as task lists when edited", () => {
    const { editor, save } = open("- [ ] open task\n- [x] done task\n");
    editor.tf.insertText("very ", { at: { path: [0, 0], offset: 0 } });
    expect(save()).toBe("- [ ] very open task\n- [x] done task\n");
  });

  it("keeps raw blocks verbatim while other blocks change", () => {
    const md = CORPUS.referencesAndHtml!;
    const { editor, save } = open(md);
    expect(editor.children.some((n) => n.type === "md_raw")).toBe(true);
    const i = blockWith(editor, "Hidden text");
    editor.tf.insertText("Still ", { at: { path: [i, 0], offset: 0 } });
    const out = save();
    expect(out).toContain('[guide]: https://example.org/guide "Guide"');
    expect(out).toContain("<details>\n<summary>More</summary>");
    expect(out).toContain("See [the guide][guide] and <kbd>Cmd</kbd>.");
    expect(out).toContain("Still Hidden text.");
  });

  it("appends a new block with a blank line", () => {
    const { editor, save } = open("First.\n");
    editor.tf.insertNodes(
      { type: "p", children: [{ text: "Second." }] },
      { at: [1] },
    );
    expect(save()).toBe("First.\n\nSecond.\n");
  });

  it("writes an emptied note as an empty string", () => {
    const { editor, save } = open("Only line.\n");
    editor.tf.setValue([{ type: "p", children: [{ text: "" }] }]);
    expect(save()).toBe("");
  });
});
