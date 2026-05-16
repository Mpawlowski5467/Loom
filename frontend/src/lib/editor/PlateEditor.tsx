import { useCallback, useEffect, useRef } from "react";
import { Plate, PlateContent, usePlateEditor } from "@udecode/plate/react";
import {
  BoldPlugin,
  ItalicPlugin,
  StrikethroughPlugin,
  CodePlugin,
} from "@udecode/plate-basic-marks/react";
import { HeadingPlugin } from "@udecode/plate-heading/react";
import { HEADING_KEYS } from "@udecode/plate-heading";
import { ListPlugin, BulletedListPlugin, NumberedListPlugin } from "@udecode/plate-list/react";
import { BlockquotePlugin } from "@udecode/plate-block-quote/react";
import { MarkdownPlugin, deserializeMd, serializeMd } from "@udecode/plate-markdown";
import type { SlateEditor } from "@udecode/plate";
import styles from "./PlateEditor.module.css";

interface PlateEditorProps {
  value: string;
  onChange: (markdown: string) => void;
}

function serializeToMd(editor: SlateEditor): string {
  return serializeMd(editor);
}

const plugins = [
  BoldPlugin,
  ItalicPlugin,
  StrikethroughPlugin,
  CodePlugin,
  HeadingPlugin,
  ListPlugin,
  BulletedListPlugin,
  NumberedListPlugin,
  BlockquotePlugin,
  MarkdownPlugin,
];

export function LoomPlateEditor({ value, onChange }: PlateEditorProps) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = usePlateEditor({
    plugins,
  });

  // Deserialize initial markdown value once on mount
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current && value) {
      try {
        const nodes = deserializeMd(editor, value);
        editor.tf.setValue(nodes);
      } catch {
        // Fallback: keep default empty state
      }
      initializedRef.current = true;
    }
  }, [editor, value]);

  const handleChange = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const md = serializeToMd(editor);
      onChange(md);
    }, 300);
  }, [editor, onChange]);

  const handleToolbar = useCallback(
    (mark: string) => {
      editor.tf.toggleMark(mark);
    },
    [editor],
  );

  const insertWikilink = useCallback(() => {
    editor.tf.insertText("[[]]");
    // Move cursor between the brackets
    const sel = editor.selection;
    if (sel) {
      const point = { ...sel.anchor, offset: sel.anchor.offset - 2 };
      editor.tf.select({ anchor: point, focus: point });
    }
  }, [editor]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar}>
        <button className={styles.toolBtn} title="Bold" onClick={() => handleToolbar("bold")}>
          B
        </button>
        <button
          className={styles.toolBtn}
          title="Italic"
          style={{ fontStyle: "italic" }}
          onClick={() => handleToolbar("italic")}
        >
          I
        </button>
        <button
          className={styles.toolBtn}
          title="Strikethrough"
          style={{ textDecoration: "line-through" }}
          onClick={() => handleToolbar("strikethrough")}
        >
          S
        </button>
        <button className={styles.toolBtn} title="Code" onClick={() => handleToolbar("code")}>
          {"{}"}
        </button>

        <span className={styles.toolDivider} />

        <button
          className={styles.toolBtn}
          title="Heading 1"
          onClick={() => editor.tf.toggleBlock(HEADING_KEYS.h1)}
        >
          H1
        </button>
        <button
          className={styles.toolBtn}
          title="Heading 2"
          onClick={() => editor.tf.toggleBlock(HEADING_KEYS.h2)}
        >
          H2
        </button>
        <button
          className={styles.toolBtn}
          title="Heading 3"
          onClick={() => editor.tf.toggleBlock(HEADING_KEYS.h3)}
        >
          H3
        </button>

        <span className={styles.toolDivider} />

        <button
          className={styles.toolBtn}
          title="Bullet list"
          onClick={() => editor.tf.toggleBlock(BulletedListPlugin.key)}
        >
          &bull;
        </button>
        <button
          className={styles.toolBtn}
          title="Numbered list"
          onClick={() => editor.tf.toggleBlock(NumberedListPlugin.key)}
        >
          1.
        </button>

        <span className={styles.toolDivider} />

        <button
          className={`${styles.toolBtn} ${styles.toolBtnWikilink}`}
          title="Insert wikilink"
          onClick={insertWikilink}
        >
          [[link]]
        </button>
      </div>

      <Plate editor={editor} onChange={handleChange}>
        <PlateContent className={styles.editor} placeholder="Start writing..." />
      </Plate>
    </div>
  );
}
