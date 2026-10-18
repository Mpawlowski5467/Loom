import { Heading2, Link2, ListTodo, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { KEYS, type TComboboxInputElement } from "platejs";
import { toggleList } from "@platejs/list";
import {
  PlateElement,
  createPlatePlugin,
  type PlateEditor,
  type PlateElementProps,
} from "platejs/react";
import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxInput,
  InlineComboboxItem,
} from "@/components/ui/inline-combobox";
import { WIKILINK_INPUT } from "./wikilink";

/** Editor-level hooks the host view provides (e.g. calling Weaver). */
export const LoomEditorPlugin = createPlatePlugin({
  key: "loom",
  options: {
    askWeaver: null as null | ((editor: PlateEditor) => void),
  },
});

interface SlashItem {
  value: string;
  label: string;
  icon: ReactNode;
  keywords: string[];
  onSelect: (editor: PlateEditor) => void;
}

const GROUPS: { group: string; items: SlashItem[] }[] = [
  {
    group: "Insert",
    items: [
      {
        value: "wikilink",
        label: "Link a note",
        icon: <Link2 />,
        keywords: ["[[", "link", "note", "wikilink"],
        onSelect: (editor) =>
          editor.tf.insertNodes({
            type: WIKILINK_INPUT,
            children: [{ text: "" }],
          }),
      },
      {
        value: "checklist",
        label: "Checklist",
        icon: <ListTodo />,
        keywords: ["todo", "task", "checkbox"],
        onSelect: (editor) => {
          toggleList(editor, { listStyleType: KEYS.listTodo });
          // Without an explicit `checked`, the item saves as a plain bullet.
          editor.tf.setNodes(
            { checked: false },
            {
              match: (n) =>
                (n as { listStyleType?: string; checked?: boolean })
                  .listStyleType === KEYS.listTodo &&
                (n as { checked?: boolean }).checked === undefined,
            },
          );
        },
      },
      {
        value: "heading",
        label: "Heading",
        icon: <Heading2 />,
        keywords: ["title", "section", "h2"],
        onSelect: (editor) => editor.tf.toggleBlock(KEYS.h2),
      },
    ],
  },
  {
    group: "Agents",
    items: [
      {
        value: "weaver",
        label: "Ask Weaver to draft this section",
        icon: <Sparkles />,
        keywords: ["weaver", "draft", "write", "agent"],
        onSelect: (editor) =>
          editor.getOption(LoomEditorPlugin, "askWeaver")?.(editor),
      },
    ],
  },
];

/** The `/` menu. Groups render with a divider between them. */
export function SlashInputElement(
  props: PlateElementProps<TComboboxInputElement>,
) {
  const { editor, element } = props;
  return (
    <PlateElement {...props} as="span">
      <InlineCombobox element={element} trigger="/">
        <InlineComboboxInput />
        <InlineComboboxContent>
          <InlineComboboxEmpty>No matching commands</InlineComboboxEmpty>
          {GROUPS.map(({ group, items }) => (
            <InlineComboboxGroup key={group}>
              {items.map((item) => (
                <InlineComboboxItem
                  key={item.value}
                  value={item.value}
                  label={item.label}
                  group={group}
                  keywords={item.keywords}
                  onClick={() => item.onSelect(editor)}
                >
                  <span
                    aria-hidden="true"
                    className="mr-2 text-muted-foreground [&_svg]:size-4"
                  >
                    {item.icon}
                  </span>
                  {item.label}
                </InlineComboboxItem>
              ))}
            </InlineComboboxGroup>
          ))}
        </InlineComboboxContent>
      </InlineCombobox>
      {props.children}
    </PlateElement>
  );
}
