import {
  BlockquoteRules,
  BoldRules,
  CodeRules,
  HeadingRules,
  HorizontalRuleRules,
  ItalicRules,
  StrikethroughRules,
} from "@platejs/basic-nodes";
import {
  BlockquotePlugin,
  BoldPlugin,
  CodePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  H4Plugin,
  H5Plugin,
  H6Plugin,
  HorizontalRulePlugin,
  ItalicPlugin,
  StrikethroughPlugin,
} from "@platejs/basic-nodes/react";
import { CodeBlockRules } from "@platejs/code-block";
import {
  CodeBlockPlugin,
  CodeLinePlugin,
  CodeSyntaxPlugin,
} from "@platejs/code-block/react";
import { IndentPlugin } from "@platejs/indent/react";
import { LinkRules } from "@platejs/link";
import { LinkPlugin } from "@platejs/link/react";
import {
  BulletedListRules,
  OrderedListRules,
  TaskListRules,
  isOrderedList,
} from "@platejs/list";
import { ListPlugin } from "@platejs/list/react";
import { MarkdownPlugin } from "@platejs/markdown";
import { ImagePlugin } from "@platejs/media/react";
import { SlashInputPlugin, SlashPlugin } from "@platejs/slash-command/react";
import {
  TableCellHeaderPlugin,
  TableCellPlugin,
  TablePlugin,
  TableRowPlugin,
} from "@platejs/table/react";
import { common, createLowlight } from "lowlight";
import { KEYS, type SlateEditor } from "platejs";
import { ParagraphPlugin } from "platejs/react";
import remarkGfm from "remark-gfm";
import type { Plugin } from "unified";
import { BlockList } from "@/components/ui/block-list";
import { BlockquoteElement } from "@/components/ui/blockquote-node";
import {
  CodeBlockElement,
  CodeLineElement,
  CodeSyntaxLeaf,
} from "@/components/ui/code-block-node";
import { CodeLeaf } from "@/components/ui/code-node";
import { HrElement } from "@/components/ui/hr-node";
import { ParagraphElement } from "@/components/ui/paragraph-node";
import {
  remarkWikilink,
  type WikilinkNode,
} from "@/editor/markdown/remarkWikilink";
import {
  H1Element,
  H2Element,
  H3Element,
  H4Element,
  H5Element,
  H6Element,
  ImageElement,
  LinkElement,
  TableCellElement,
  TableCellHeaderElement,
  TableElement,
  TableRowElement,
} from "./nodes";
import {
  MD_RAW,
  RawMarkdownPlugin,
  type TRawMarkdownElement,
} from "./rawMarkdown";
import { LoomEditorPlugin, SlashInputElement } from "./slash";
import {
  WIKILINK,
  WikilinkInputPlugin,
  WikilinkPlugin,
  type TWikilinkElement,
} from "./wikilink";

const lowlight = createLowlight(common);

/** Blocks lists and indentation apply to. */
const BLOCKS = [
  ...KEYS.heading,
  KEYS.p,
  KEYS.blockquote,
  KEYS.codeBlock,
  KEYS.img,
];

const heading = (plugin: typeof H1Plugin, component: typeof H1Element) =>
  plugin.configure({
    inputRules: [HeadingRules.markdown()],
    node: { component },
    rules: { break: { empty: "reset" } },
  });

/** Markdown ↔ Plate conversion shared by the editor and the lossless bridge. */
export const markdownPlugin = MarkdownPlugin.configure({
  options: {
    // The cast widens remarkWikilink's Root-typed transformer to Plate's
    // generic Plugin type; it only ever receives a Root.
    remarkPlugins: [remarkGfm, remarkWikilink as Plugin],
    remarkStringifyOptions: {
      bullet: "-",
      rule: "-",
      emphasis: "*",
      strong: "*",
    },
    rules: {
      // Raw blocks normally come back verbatim via the lossless bridge;
      // this covers one copied into a new position.
      [MD_RAW]: {
        serialize: (node: TRawMarkdownElement) => ({
          type: "html",
          value: node.source,
        }),
      },
      [WIKILINK]: {
        deserialize: (node: WikilinkNode) => ({
          type: WIKILINK,
          target: node.target,
          ...(node.alias ? { alias: node.alias } : {}),
          children: [{ text: "" }],
        }),
        serialize: (node: TWikilinkElement) => ({
          type: "wikilink",
          target: node.target,
          ...(node.alias ? { alias: node.alias } : {}),
        }),
      },
    },
  },
});

/** Every plugin the note editor uses. */
export const notePlugins = [
  ParagraphPlugin.withComponent(ParagraphElement),
  heading(H1Plugin, H1Element),
  heading(H2Plugin, H2Element),
  heading(H3Plugin, H3Element),
  heading(H4Plugin, H4Element),
  heading(H5Plugin, H5Element),
  heading(H6Plugin, H6Element),
  BlockquotePlugin.configure({
    inputRules: [BlockquoteRules.markdown()],
    node: { component: BlockquoteElement },
  }),
  HorizontalRulePlugin.configure({
    inputRules: [HorizontalRuleRules.markdown({ variant: "-" })],
    node: { component: HrElement },
  }),
  BoldPlugin.configure({ inputRules: [BoldRules.markdown({ variant: "*" })] }),
  ItalicPlugin.configure({
    inputRules: [ItalicRules.markdown({ variant: "*" })],
  }),
  StrikethroughPlugin.configure({
    inputRules: [StrikethroughRules.markdown()],
  }),
  CodePlugin.configure({
    inputRules: [CodeRules.markdown()],
    node: { component: CodeLeaf },
  }),
  LinkPlugin.configure({
    inputRules: [
      LinkRules.markdown(),
      LinkRules.autolink({ variant: "paste" }),
    ],
    render: { node: LinkElement },
  }),
  CodeBlockPlugin.configure({
    inputRules: [CodeBlockRules.markdown({ on: "match" })],
    node: { component: CodeBlockElement },
    options: { lowlight },
  }),
  CodeLinePlugin.withComponent(CodeLineElement),
  CodeSyntaxPlugin.withComponent(CodeSyntaxLeaf),
  IndentPlugin.configure({ inject: { targetPlugins: BLOCKS } }),
  ListPlugin.configure({
    inputRules: [
      BulletedListRules.markdown({ variant: "-" }),
      OrderedListRules.markdown({ variant: "." }),
      TaskListRules.markdown({ checked: false }),
      TaskListRules.markdown({ checked: true }),
    ],
    inject: {
      nodeProps: {
        nodeKey: KEYS.listType,
        query: ({ nodeProps }) =>
          !!nodeProps.element?.listStyleType &&
          !isOrderedList(nodeProps.element),
        // Bullets come from display: list-item. No role="listitem": these
        // blocks have no list parent, which is invalid ARIA (axe).
        transformProps: ({ props }) => ({
          ...props,
          style: { ...props.style, display: "list-item" },
        }),
      },
      targetPlugins: BLOCKS,
    },
    render: { belowNodes: BlockList },
  }),
  TablePlugin.withComponent(TableElement),
  TableRowPlugin.withComponent(TableRowElement),
  TableCellPlugin.withComponent(TableCellElement),
  TableCellHeaderPlugin.withComponent(TableCellHeaderElement),
  ImagePlugin.withComponent(ImageElement),
  WikilinkPlugin,
  WikilinkInputPlugin,
  RawMarkdownPlugin,
  SlashPlugin.configure({
    options: {
      triggerQuery: (editor: SlateEditor) =>
        !editor.api.some({ match: { type: editor.getType(KEYS.codeBlock) } }),
    },
  }),
  SlashInputPlugin.withComponent(SlashInputElement),
  LoomEditorPlugin,
  markdownPlugin,
];
