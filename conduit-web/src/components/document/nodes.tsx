import { Extension, InputRule, type AnyExtension, type Editor, type NodeViewRenderer } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import type { Node } from "@tiptap/pm/model";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import type { EditorView, ViewMutationRecord } from "@tiptap/pm/view";
import { createEffect, createSignal, type JSX, type Signal } from "solid-js";
import { render } from "solid-js/web";
import { Input } from "@/components/ui";
import { DocumentDate, DocumentFold, DocumentImage, DocumentToneMark, documentBlockClass } from "@/components/ui/document";
import { Popover, PopoverContent } from "@/components/ui/menus";
import { IMAGE_NAME, documentExtensions, fitted, isDay } from "@/document-format.js";
import { caretBlockAt } from "./blocks";
import type { DocumentHost } from "./host";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"];
const pad = (n: number) => String(n).padStart(2, "0");
/** A day from today in the reader's own time, as the format keeps it. */
export const dayFrom = (days = 0) => { const day = new Date(); day.setDate(day.getDate() + days); return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`; };

// How far each toggle is folded is the reader's, on this page only, never written: folded until opened, and opened when the caret goes in.
const folds = new Map<string, Signal<boolean>>();
const fold = (id: string) => folds.get(id) ?? folds.set(id, createSignal(false)).get(id)!;

/** A node view whose parts are drawn by Solid into `dom`, gone with it; `content`: where ProseMirror writes the node's own blocks. */
const drawn = (dom: HTMLElement, part: HTMLElement, view: () => JSX.Element, content?: HTMLElement) => ({
  dom, contentDOM: content, destroy: render(view, part),
  // A press on what Solid drew is its own; what ProseMirror writes is ProseMirror's.
  stopEvent: (event: Event) => part.contains(event.target as globalThis.Node),
  ignoreMutation: (mutation: ViewMutationRecord) => mutation.type !== "selection" && !(content?.contains(mutation.target) ?? false),
});
const at = (getPos: () => number | undefined, view: EditorView, attr: string, value: unknown) => { const pos = getPos(); if (typeof pos === "number") view.dispatch(view.state.tr.setNodeAttribute(pos, attr, value)); };

const views = (host: DocumentHost): Record<string, NodeViewRenderer> => ({
  image: ({ node, view, getPos }) => {
    const dom = document.createElement("div"), [now, setNow] = createSignal(node), [src, setSrc] = createSignal<string>(), [missing, setMissing] = createSignal<string>();
    dom.contentEditable = "false";
    dom.dataset.id = node.attrs.id ?? "";
    // A name the hub keeps is drawn through the host; anything else (an address an agent or a paste wrote) is never fetched.
    const load = (name: string) => {
      setSrc(undefined); setMissing(undefined);
      if (!host.images || !IMAGE_NAME.test(name)) return setMissing(`Not kept with this paper: ${name || "no image"}`);
      Promise.resolve(host.images.src(name)).then(setSrc, () => setMissing("This image could not be loaded"));
    };
    load(node.attrs.src);
    // The picture is ProseMirror's to press (it selects the block); the caption's field is its own.
    return { ...drawn(dom, dom, () => <DocumentImage src={src()} missing={missing()} caption={now().attrs.alt} onCaption={view.editable ? (alt) => at(getPos, view, "alt", alt) : undefined} />),
      stopEvent: (event: Event) => (event.target as Element).closest?.("input") !== null, ignoreMutation: () => true,
      update: (next: Node) => { if (next.type !== node.type) return false; if (next.attrs.src !== now().attrs.src) load(next.attrs.src); dom.dataset.id = next.attrs.id ?? ""; setNow(next); return true; } };
  },
  callout: ({ node }) => {
    const dom = document.createElement("aside"), mark = document.createElement("span"), content = document.createElement("div"), [tone, setTone] = createSignal<"note" | "warning">(node.attrs.tone);
    dom.className = documentBlockClass.callout;
    mark.contentEditable = "false";
    dom.append(mark, content);
    const set = (next: Node) => { dom.dataset.tone = next.attrs.tone; dom.dataset.id = next.attrs.id ?? ""; setTone(next.attrs.tone); };
    set(node);
    return { ...drawn(dom, mark, () => <DocumentToneMark tone={tone()} />, content), update: (next: Node) => next.type === node.type && (set(next), true) };
  },
  toggle: ({ node }) => {
    const dom = document.createElement("div"), head = document.createElement("span"), content = document.createElement("div"), [id, setId] = createSignal<string>(node.attrs.id ?? "");
    dom.className = documentBlockClass.toggle;
    content.className = documentBlockClass.toggleBody;
    head.contentEditable = "false";
    dom.append(head, content);
    const open = () => fold(id())[0](), turn = () => fold(id())[1]((was) => !was);
    const set = (next: Node) => { setId(next.attrs.id ?? ""); dom.dataset.id = next.attrs.id ?? ""; };
    set(node);
    return { ...drawn(dom, head, () => { createEffect(() => dom.toggleAttribute("data-open", open())); return <DocumentFold open={open()} onToggle={turn} />; }, content), update: (next: Node) => next.type === node.type && (set(next), true) };
  },
  date: ({ node, view, getPos }) => {
    const dom = document.createElement("span"), [date, setDate] = createSignal<string>(node.attrs.date), [open, setOpen] = createSignal(false);
    dom.contentEditable = "false";
    let chip: HTMLButtonElement | undefined;
    const pick = (value: string) => { if (isDay(value)) at(getPos, view, "date", value); setOpen(false); };
    return { ...drawn(dom, dom, () => <>
      <DocumentDate ref={(element) => { chip = element; }} date={date()} onPress={() => { if (view.editable) setOpen(true); }} />
      <Popover open={open()} onOpenChange={setOpen} anchorRef={() => chip} placement="bottom-start">
        <PopoverContent aria-label="Date" width="sm"><Input type="date" aria-label="Date" value={date()} onChange={(event) => pick(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") pick(event.currentTarget.value); }} /></PopoverContent>
      </Popover>
    </>), stopEvent: () => true, ignoreMutation: () => true, update: (next: Node) => next.type === node.type && (setDate(next.attrs.date), true) };
  },
});

/** The format's nodes, each drawn by its view here. */
export const viewed = (extensions: AnyExtension[], host: DocumentHost) => {
  const made = views(host);
  return extensions.map((extension) => made[extension.name] ? extension.extend({ addNodeView: () => made[extension.name]! }) : extension);
};

// Made once, when first asked: it adds the format's own Markdown to the parser it is given.
let manager: MarkdownManager | undefined;
const markdown = () => (manager ??= new MarkdownManager({ extensions: documentExtensions() }));
/** What looks written in Markdown rather than as plain lines: a heading, a list, a quote, a fence, a table row, an image, or a strong run or a link inside text. */
const MARKDOWN = /^(?: {0,3}#{1,6}\s|\s*[-*+]\s|\s*\d+[.)]\s|\s*>|\s*```|\s*~~~|\s*\|.*\|\s*$|!\[)|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\s]+\)/m;
/** Markdown put in at the caret as blocks; one paragraph's worth goes into the line as text does. */
export const insertMarkdown = (editor: Editor, text: string) => {
  const blocks = (fitted(markdown().parse(text)).content ?? []) as { type: string; content?: unknown[] }[];
  const content = blocks.length === 1 && blocks[0]!.type === "paragraph" ? blocks[0]!.content ?? [] : blocks;
  return editor.chain().focus().insertContent(content as never).run();
};

/** Images put in after the caret's block (in its place where it is an empty line), as each is kept by the hub; one the hub refuses is left out. */
const putImages = async (editor: Editor, host: DocumentHost, files: File[]) => {
  for (const file of files) {
    const name = await host.images?.keep(file).catch(() => null);
    if (!name) continue;
    const view = editor.view, from = caretBlockAt(view), block = from === null ? null : view.state.doc.nodeAt(from);
    const image = { type: "image", attrs: { src: name, alt: "" } };
    if (!block) editor.chain().focus().insertContent(image).run();
    else if (block.type.name === "paragraph" && !block.content.size) editor.chain().focus().insertContentAt({ from: from!, to: from! + block.nodeSize }, image).run();
    else editor.chain().focus().insertContentAt(from! + block.nodeSize, image).run();
  }
};
const imagesIn = (data: DataTransfer | null) => [...data?.files ?? []].filter((file) => IMAGE_TYPES.includes(file.type));
/** The file picker, for the images chosen. */
export const pickImages = (editor: Editor, host: DocumentHost) => {
  const input = Object.assign(document.createElement("input"), { type: "file", accept: IMAGE_TYPES.join(","), multiple: true });
  input.addEventListener("change", () => void putImages(editor, host, [...input.files ?? []]), { once: true });
  input.click();
};

/**
 * What the paper's own blocks bring to typing: `@today` and `@tomorrow` become a date (`dates`); an image pasted or dropped is kept and put in
 * (`images`); Markdown pasted as text becomes blocks (not in code, and not where the clipboard holds a page's own blocks, which ProseMirror reads
 * itself); and a folded toggle opens when the caret goes into what it folds.
 */
export const paperTyping = (host: DocumentHost, offers: { dates: boolean; images: boolean }) => Extension.create({
  name: "paperTyping",
  addInputRules() {
    return offers.dates ? [new InputRule({ find: /(?<!\S)@(today|tomorrow)(\s)$/i, handler: ({ state, range, match }) => {
      state.tr.replaceWith(range.from, range.to, [state.schema.nodes.date!.create({ date: dayFrom(match[1]!.toLowerCase() === "tomorrow" ? 1 : 0) }), state.schema.text(match[2]!)]);
    } })] : [];
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({
      props: {
        handlePaste: (view, event) => {
          const files = imagesIn(event.clipboardData);
          if (files.length && offers.images) { void putImages(editor, host, files); return true; }
          const text = event.clipboardData?.getData("text/plain") ?? "", html = event.clipboardData?.getData("text/html") ?? "";
          if (view.state.selection.$from.parent.type.spec.code || !MARKDOWN.test(text) || /<(?:p|h[1-6]|ul|ol|li|table|blockquote|pre)\b/i.test(html)) return false;
          return insertMarkdown(editor, text);
        },
        handleDrop: (view, event, _slice, moved) => {
          const files = moved || !offers.images ? [] : imagesIn(event.dataTransfer);
          if (!files.length) return false;
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (pos) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos.pos))));
          void putImages(editor, host, files);
          return true;
        },
      },
      view: () => ({ update: (view) => {
        const { $from } = view.state.selection;
        for (let depth = $from.depth; depth > 0; depth -= 1) if ($from.node(depth).type.name === "toggle" && $from.index(depth) > 0) fold($from.node(depth).attrs.id ?? "")[1](true);
      } }),
    })];
  },
});
