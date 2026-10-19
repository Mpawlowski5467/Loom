import type { TImageElement, TLinkElement } from "platejs";
import { PlateElement, type PlateElementProps } from "platejs/react";
import { cn } from "@/lib/utils";

/*
 * Element components for note bodies, drawn with theme tokens. Simpler
 * than Plate UI's registry versions (no drag handles, toolbars or
 * resizing), which pull in dependencies Loom doesn't use.
 */

const HEADING: Record<string, string> = {
  h1: "mt-8 mb-3 text-[26px] leading-tight font-semibold tracking-tight",
  h2: "mt-7 mb-2 text-[21px] leading-snug font-semibold tracking-tight",
  h3: "mt-6 mb-2 text-[18px] leading-snug font-semibold",
  h4: "mt-5 mb-1 text-[16px] font-semibold",
  h5: "mt-4 mb-1 text-[15px] font-semibold",
  h6: "mt-4 mb-1 text-[14px] font-semibold text-muted-foreground",
};

function heading(tag: keyof typeof HEADING) {
  function HeadingElement(props: PlateElementProps) {
    return (
      <PlateElement
        {...props}
        as={tag as "h1"}
        className={cn("font-sans text-foreground first:mt-0", HEADING[tag])}
      >
        {props.children}
      </PlateElement>
    );
  }
  HeadingElement.displayName = `Heading${tag.toUpperCase()}`;
  return HeadingElement;
}

export const H1Element = heading("h1");
export const H2Element = heading("h2");
export const H3Element = heading("h3");
export const H4Element = heading("h4");
export const H5Element = heading("h5");
export const H6Element = heading("h6");

/** External links; ⌘/Ctrl-click opens them (plain clicks place the caret). */
export function LinkElement(props: PlateElementProps<TLinkElement>) {
  const { url } = props.element;
  return (
    <PlateElement
      {...props}
      as="a"
      className="font-medium text-brand underline decoration-brand/40 underline-offset-4 hover:decoration-brand"
      attributes={{
        ...props.attributes,
        href: url,
        title: url,
        onClick: (e: React.MouseEvent) => {
          if (!(e.metaKey || e.ctrlKey)) return;
          e.preventDefault();
          window.open(url, "_blank", "noopener,noreferrer");
        },
      }}
    >
      {props.children}
    </PlateElement>
  );
}

export function TableElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} className="my-4 overflow-x-auto">
      <table className="w-full border-collapse font-sans text-sm">
        <tbody>{props.children}</tbody>
      </table>
    </PlateElement>
  );
}

export function TableRowElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="tr" className="border-b border-border">
      {props.children}
    </PlateElement>
  );
}

export function TableCellElement(props: PlateElementProps) {
  return (
    <PlateElement
      {...props}
      as="td"
      className="border border-border px-3 py-1.5 align-top"
    >
      {props.children}
    </PlateElement>
  );
}

export function TableCellHeaderElement(props: PlateElementProps) {
  return (
    <PlateElement
      {...props}
      as="th"
      className="border border-border bg-muted px-3 py-1.5 text-left align-top font-medium text-foreground"
    >
      {props.children}
    </PlateElement>
  );
}

export function ImageElement(props: PlateElementProps<TImageElement>) {
  const { url } = props.element;
  const alt = (props.element as TImageElement & { alt?: string }).alt;
  return (
    <PlateElement {...props} className="my-4">
      <figure contentEditable={false} className="flex flex-col gap-1">
        <img
          src={url}
          alt={alt ?? ""}
          className="max-h-[480px] rounded-md border border-border object-contain"
        />
        {alt && (
          <figcaption className="text-xs text-muted-foreground">
            {alt}
          </figcaption>
        )}
      </figure>
      {props.children}
    </PlateElement>
  );
}
