import { useMemo, useState } from "react";
import type { TComboboxInputElement, TElement } from "platejs";
import { KEYS, createSlatePlugin } from "platejs";
import {
  PlateElement,
  toPlatePlugin,
  useFocused,
  useSelected,
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
import { useApp } from "@/context/app-ctx";
import { wikilinkCandidates } from "@/data/wikilinks";
import {
  wikilinkSuggestions,
  wikilinkTarget,
} from "@/editor/wikilinkCompletion";
import { cn } from "@/lib/utils";

export const WIKILINK = "wikilink";
export const WIKILINK_INPUT = "wikilink_input";

export interface TWikilinkElement extends TElement {
  type: typeof WIKILINK;
  /** As written: "note", "folder/note", "note#Heading". */
  target: string;
  alias?: string;
}

/** `[[x]]` typed as plain text just before the cursor, closed by "]". */
const CLOSED_LINK = /\[\[([^[\]|\n]+?)(?:\|([^[\]\n]+?))?\]$/;

const BaseWikilinkInputPlugin = createSlatePlugin({
  key: WIKILINK_INPUT,
  editOnly: true,
  node: { isElement: true, isInline: true, isVoid: true },
});

/**
 * `[[wikilinks]]` as inline void chips. Typing `[[` opens a note picker;
 * typing the closing `]]` of a hand-written link turns it into a chip.
 */
const BaseWikilinkPlugin = createSlatePlugin({
  key: WIKILINK,
  node: { isElement: true, isInline: true, isVoid: true, isMarkableVoid: true },
  plugins: [BaseWikilinkInputPlugin],
}).overrideEditor(({ editor, tf: { insertText } }) => ({
  transforms: {
    insertText(text, options) {
      const plain =
        !options?.at &&
        editor.selection &&
        !editor.api.isExpanded() &&
        !editor.api.some({ match: { type: editor.getType(KEYS.codeBlock) } }) &&
        !editor.api.marks()?.[KEYS.code];
      if (!plain || (text !== "[" && text !== "]"))
        return insertText(text, options);

      const blockStart = editor.api.start(editor.api.block()![1]);
      const before = editor.api.string({
        anchor: blockStart!,
        focus: editor.selection!.anchor,
      });

      if (text === "[" && before.endsWith("[")) {
        editor.tf.withoutNormalizing(() => {
          editor.tf.deleteBackward("character");
          editor.tf.insertNodes({
            type: WIKILINK_INPUT,
            children: [{ text: "" }],
          });
        });
        return;
      }
      const closed = text === "]" ? CLOSED_LINK.exec(before) : null;
      if (closed) {
        editor.tf.withoutNormalizing(() => {
          editor.tf.delete({
            distance: closed[0].length,
            reverse: true,
            unit: "character",
          });
          editor.tf.insertNodes({
            type: WIKILINK,
            target: closed[1]!.trim(),
            ...(closed[2] ? { alias: closed[2].trim() } : {}),
            children: [{ text: "" }],
          });
          editor.tf.move({ unit: "offset" });
        });
        return;
      }
      insertText(text, options);
    },
  },
}));

/** The chip: resolved links open their note, unresolved ones are dashed. */
export function WikilinkElement(props: PlateElementProps<TWikilinkElement>) {
  const { element } = props;
  const { resolveWikilink, openNote, notes } = useApp();
  const selected = useSelected();
  const focused = useFocused();
  const [path, heading = ""] = element.target.split("#", 2) as [
    string,
    string?,
  ];
  const id = resolveWikilink(path);
  const ambiguous = !id && wikilinkCandidates(notes, path).length > 1;
  return (
    <PlateElement
      {...props}
      as="span"
      className={cn(
        "mx-px inline-block rounded-sm px-1.5 py-px align-baseline font-sans text-[0.9em] leading-snug font-medium",
        id
          ? "cursor-pointer bg-chip text-chip-foreground hover:underline"
          : "border border-dashed border-chip-foreground/50 text-chip-foreground",
        selected && focused && "ring-2 ring-ring",
      )}
      attributes={{
        ...props.attributes,
        contentEditable: false,
        "data-wikilink": element.target,
        title: id
          ? undefined
          : ambiguous
            ? "More than one note matches"
            : "No note with this name yet",
        onClick: id ? () => openNote(id, heading) : undefined,
      }}
    >
      {element.alias ?? element.target}
      {props.children}
    </PlateElement>
  );
}

/** The `[[` picker: searches note titles, slugs and aliases. */
export function WikilinkInputElement(
  props: PlateElementProps<TComboboxInputElement>,
) {
  const { editor, element } = props;
  const { notes } = useApp();
  const [search, setSearch] = useState("");
  const matches = useMemo(
    () => wikilinkSuggestions(notes, search),
    [notes, search],
  );
  return (
    <PlateElement {...props} as="span">
      <InlineCombobox
        element={element}
        trigger="[["
        value={search}
        setValue={setSearch}
        filter={false}
      >
        <span className="inline-block rounded-sm bg-chip px-1 align-baseline font-sans text-[0.9em] text-chip-foreground ring-ring focus-within:ring-2">
          [[
          <InlineComboboxInput />
        </span>
        <InlineComboboxContent className="my-1.5">
          <InlineComboboxEmpty>No matching notes</InlineComboboxEmpty>
          <InlineComboboxGroup>
            {matches.map((note) => {
              const target = wikilinkTarget(note, notes);
              return (
                <InlineComboboxItem
                  key={note.id}
                  value={note.id}
                  onClick={() => {
                    editor.tf.insertNodes({
                      type: WIKILINK,
                      target,
                      children: [{ text: "" }],
                    });
                    editor.tf.move({ unit: "offset" });
                  }}
                >
                  <span className="truncate">{note.title}</span>
                  <span className="ml-auto pl-3 font-mono text-[11px] text-muted-foreground">
                    {target}
                  </span>
                </InlineComboboxItem>
              );
            })}
          </InlineComboboxGroup>
        </InlineComboboxContent>
      </InlineCombobox>
      {props.children}
    </PlateElement>
  );
}

export const WikilinkPlugin =
  toPlatePlugin(BaseWikilinkPlugin).withComponent(WikilinkElement);
export const WikilinkInputPlugin = toPlatePlugin(
  BaseWikilinkInputPlugin,
).withComponent(WikilinkInputElement);
