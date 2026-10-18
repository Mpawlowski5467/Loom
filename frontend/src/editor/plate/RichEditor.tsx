import { useCallback, useEffect, useRef, useState } from "react";
import { MarkdownPlugin } from "@platejs/markdown";
import type { TElement } from "platejs";
import {
  createPlateEditor,
  Plate,
  usePlateEditor,
  type PlateEditor,
} from "platejs/react";
import { draftSection, EndpointMissingError } from "@/api/weaver";
import { Editor, EditorContainer } from "@/components/ui/editor";
import { useApp } from "@/context/app-ctx";
import { captureBaseline, loadNote, saveNote } from "./markdownBridge";
import { notePlugins } from "./plugins";
import { LoomEditorPlugin } from "./slash";

interface RichEditorProps {
  noteId: string;
  /** Loaded once per mount; the parent remounts (key) on outside changes. */
  markdown: string;
  onChange: (markdown: string) => void;
}

/** An off-screen editor that parses markdown with the note plugins. */
let parser: PlateEditor | null = null;
function markdownParser(): PlateEditor {
  parser ??= createPlateEditor({ plugins: notePlugins });
  return parser;
}

/** The section heading above `index`, and the text written under it. */
function sectionAt(editor: PlateEditor, index: number) {
  let start = index;
  while (
    start >= 0 &&
    !/^h[1-6]$/.test((editor.children[start] as TElement).type)
  )
    start--;
  const heading = start >= 0 ? editor.api.string([start]) : "";
  const context = editor.children
    .slice(start + 1, index + 1)
    .map((_, i) => editor.api.string([start + 1 + i]))
    .join("\n");
  return { heading, context };
}

/**
 * The WYSIWYG note body (Plate). Markdown in, markdown out through the
 * lossless bridge, so untouched blocks are saved exactly as written.
 */
export function RichEditor({ noteId, markdown, onChange }: RichEditorProps) {
  const { pushToast } = useApp();
  const [loaded] = useState(() => loadNote(markdownParser(), markdown));
  const editor = usePlateEditor({ plugins: notePlugins, value: loaded.value });
  const [baseline] = useState(() => captureBaseline(editor.children));
  const last = useRef(markdown);

  const askWeaver = useCallback(
    async (ed: PlateEditor) => {
      const index = ed.api.block()?.[1][0] ?? ed.children.length - 1;
      const { heading, context } = sectionAt(ed, index);
      pushToast({ icon: "✎", agent: "weaver", body: "Drafting this section…" });
      try {
        const md = await draftSection({ note_id: noteId, heading, context });
        const nodes = ed
          .getApi(MarkdownPlugin)
          .markdown.deserialize(md, { withoutMdx: true });
        ed.tf.insertNodes(nodes, { at: [index + 1] });
      } catch (err) {
        pushToast({
          icon: "⚠",
          agent: "weaver",
          body:
            err instanceof EndpointMissingError
              ? err.message
              : `Weaver couldn't draft: ${err instanceof Error ? err.message : "unknown error"}`,
        });
      }
    },
    [noteId, pushToast],
  );

  useEffect(() => {
    editor.setOption(LoomEditorPlugin, "askWeaver", (ed) => void askWeaver(ed));
  }, [editor, askWeaver]);

  return (
    <Plate
      editor={editor}
      onValueChange={({ editor: ed }) => {
        const next = saveNote(ed, loaded, baseline);
        if (next === last.current) return;
        last.current = next;
        onChange(next);
      }}
    >
      <EditorContainer variant="note">
        <Editor
          variant="note"
          placeholder="Write, or type / for commands…"
          aria-label="Note body"
        />
      </EditorContainer>
    </Plate>
  );
}
