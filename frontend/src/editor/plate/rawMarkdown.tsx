import { createSlatePlugin, type TElement } from "platejs";
import {
  PlateElement,
  toPlatePlugin,
  type PlateElementProps,
} from "platejs/react";

export const MD_RAW = "md_raw";

/** A block kept as its markdown source (see sourceBlocks `editable`). */
export interface TRawMarkdownElement extends TElement {
  type: typeof MD_RAW;
  source: string;
}

/** Read-only in the rich editor; edit it in markdown mode. */
export function RawMarkdownElement(
  props: PlateElementProps<TRawMarkdownElement>,
) {
  return (
    <PlateElement {...props} className="my-3">
      <div
        contentEditable={false}
        className="rounded-md border border-dashed border-border-strong bg-muted/40 px-3 py-2"
      >
        <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap text-secondary-foreground">
          {props.element.source}
        </pre>
        <p className="mt-1 font-sans text-[11px] text-muted-foreground">
          Kept as markdown. Switch to markdown mode to edit it.
        </p>
      </div>
      {props.children}
    </PlateElement>
  );
}

export const RawMarkdownPlugin = toPlatePlugin(
  createSlatePlugin({ key: MD_RAW, node: { isElement: true, isVoid: true } }),
).withComponent(RawMarkdownElement);
