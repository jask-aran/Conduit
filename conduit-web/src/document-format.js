import { Mark, mergeAttributes, Node } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { UniqueID } from "@tiptap/extension-unique-id";
import StarterKit from "@tiptap/starter-kit";

/*
 * The Conduit document format, built the same way by the hub's document service (server/documents.js) and the editor
 * (components/document): a document is a list of blocks, and every block carries an id that never changes, which is
 * what a thread or an agent's edit names. The live copy is a Yjs document: its FRAGMENT holds the blocks, and its
 * AUTHORS map names who wrote under each Yjs client id, so every character keeps its author. Its CHANGES map is what
 * agents changed to answer a comment and the person has not yet accepted: block id -> { for: "<item>/<n>" (the comment),
 * before: the block as it was (null: the block is new), after: the id of the block a deleted one followed (null: it
 * was first), by, at }. A change is gone once the person resolves its comment, or it is taken back.
 */
export const BLOCK_TYPES = ["paragraph", "heading", "blockquote", "codeBlock", "bulletList", "orderedList", "taskList", "listItem", "taskItem", "table", "horizontalRule", "image", "callout", "toggle"];
export const FRAGMENT = "blocks";
export const AUTHORS = "authors";
export const CHANGES = "changes";
// The paper's front matter: a Yjs map of name -> text (its status, who it is for, a date), shown under its title and written first in its file and its Markdown.
export const PROPERTIES = "properties";
export const blockId = () => Math.random().toString(36).slice(2, 10).padEnd(8, "0");

/** The name the hub keeps an image under beside its paper: its hash and what it is. An image block holds this, never the bytes. */
export const IMAGE_NAME = /^[a-f0-9]{16}\.(?:png|jpg|gif|webp|avif)$/;
export const CALLOUT_TONES = ["note", "warning"];
const ISO = /^\d{4}-\d{2}-\d{2}(?![\w-])/;
/** A day that is on the calendar, as `YYYY-MM-DD`. */
export const isDay = (text) => typeof text === "string" && /^\d{4}-\d{2}-\d{2}$/.test(text) && new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text;
// A block of Markdown that only these lines make: `start` says where one may begin, so a paragraph above it ends there.
const lineStart = (pattern) => (src) => src.search(pattern);

/** One image, its caption the alt text: `![caption](name)` alone on a line, the name the one the hub keeps it under. */
const Image = Node.create({
  name: "image", group: "block", atom: true,
  addAttributes: () => ({ src: { default: "" }, alt: { default: "" } }),
  parseHTML: () => [{ tag: "figure[data-image]", getAttrs: (element) => ({ src: element.getAttribute("data-image") ?? "", alt: element.getAttribute("data-alt") ?? "" }) }],
  renderHTML: ({ node }) => ["figure", { "data-image": node.attrs.src, "data-alt": node.attrs.alt }],
  markdownTokenName: "paperImage",
  markdownTokenizer: {
    name: "paperImage", level: "block", start: lineStart(/^!\[[^\]\n]*\]\([^)\s]+\)[ \t]*$/m),
    tokenize: (src) => { const found = /^!\[((?:\\.|[^\]\\\n])*)\]\(<?([^)\s>]+)>?\)[ \t]*(?:\n+|$)/.exec(src); return found ? { type: "paperImage", raw: found[0], alt: found[1].replace(/\\(.)/g, "$1"), src: found[2] } : undefined; },
  },
  // An image inside a line of text is asked of this node too (by its name): it stays its caption's words there, since a block cannot stand in a line.
  parseMarkdown: (token, h) => token.type === "paperImage" ? h.createNode("image", { src: token.src, alt: token.alt }) : token.text ? h.createTextNode(token.text) : [],
  renderMarkdown: (node) => `![${String(node.attrs?.alt ?? "").replace(/[\\\]]/g, "\\$&").replace(/\n/g, " ")}](${node.attrs?.src ?? ""})`,
});

/** A tinted box of blocks with a tone: a quote whose first line is `[!NOTE]` or `[!WARNING]`. */
const Callout = Node.create({
  name: "callout", group: "block", content: "block+", defining: true,
  addAttributes: () => ({ tone: { default: "note", parseHTML: (element) => CALLOUT_TONES.includes(element.getAttribute("data-tone")) ? element.getAttribute("data-tone") : "note", renderHTML: (attrs) => ({ "data-tone": attrs.tone }) } }),
  parseHTML: () => [{ tag: "aside[data-callout]" }],
  renderHTML: ({ HTMLAttributes }) => ["aside", mergeAttributes(HTMLAttributes, { "data-callout": "" }), 0],
  markdownTokenName: "callout",
  markdownTokenizer: {
    name: "callout", level: "block", start: lineStart(/^ {0,3}> ?\[!(?:note|warning)\][ \t]*$/im),
    tokenize(src, _tokens, lexer) {
      const quote = /^(?: {0,3}>[^\n]*(?:\n|$))+/.exec(src)?.[0], head = quote && /^ {0,3}> ?\[!(note|warning)\][ \t]*(?:\n|$)/i.exec(quote);
      if (!head) return undefined;
      const body = quote.slice(head[0].length).split("\n").map((line) => line.replace(/^ {0,3}> ?/, "")).join("\n");
      return { type: "callout", raw: quote, tone: head[1].toLowerCase(), tokens: lexer.blockTokens(body) };
    },
  },
  parseMarkdown: (token, h) => { const blocks = h.parseChildren(token.tokens ?? []); return h.createNode("callout", { tone: token.tone }, blocks.length ? blocks : [h.createNode("paragraph", undefined, [])]); },
  renderMarkdown: (node, h) => [`[!${String(node.attrs?.tone ?? "note").toUpperCase()}]`, ...h.renderChildren(node.content ?? [], "\n\n").split("\n")].map((line) => line.trim() ? `> ${line}` : ">").join("\n"),
});

/** A summary line over blocks that fold under it (how far is each reader's own, never written): `<details><summary>…</summary>…</details>`. */
const Toggle = Node.create({
  name: "toggle", group: "block", content: "paragraph block*", defining: true,
  parseHTML: () => [{ tag: "div[data-toggle]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-toggle": "" }), 0],
  markdownTokenName: "toggle",
  markdownTokenizer: {
    name: "toggle", level: "block", start: lineStart(/^ {0,3}<details>/im),
    tokenize(src, _tokens, lexer) {
      if (!/^ {0,3}<details>/i.test(src)) return undefined;
      // To its own closing tag: a toggle may hold toggles.
      const tags = /<\/?details>/gi;
      let depth = 0, end = -1;
      for (const tag of src.matchAll(tags)) { depth += tag[0][1] === "/" ? -1 : 1; if (!depth) { end = tag.index + tag[0].length; break; } }
      if (end < 0) return undefined;
      const raw = src.slice(0, end) + (/^[ \t]*(?:\n+|$)/.exec(src.slice(end))?.[0] ?? ""), inner = src.slice(src.indexOf(">") + 1, end - "</details>".length);
      const summary = /^\s*<summary>([\s\S]*?)<\/summary>/i.exec(inner);
      return { type: "toggle", raw, summary: lexer.inlineTokens(summary?.[1].trim() ?? ""), tokens: lexer.blockTokens(summary ? inner.slice(summary[0].length) : inner) };
    },
  },
  parseMarkdown: (token, h) => h.createNode("toggle", undefined, [h.createNode("paragraph", undefined, h.parseInline(token.summary ?? [])), ...h.parseChildren(token.tokens ?? [])]),
  renderMarkdown: (node, h) => {
    const [summary, ...body] = node.content ?? [], inner = h.renderChildren(body, "\n\n");
    return `<details>\n<summary>${summary ? h.renderChildren(summary.content ?? []) : ""}</summary>\n${inner ? `\n${inner}\n\n` : ""}</details>`;
  },
});

/** A day in the text, kept as `YYYY-MM-DD` and drawn in the reader's own way of writing dates; in Markdown the ISO date as it is, which reads back as a date. */
const Day = Node.create({
  name: "date", group: "inline", inline: true, atom: true,
  addAttributes: () => ({ date: { default: "", parseHTML: (element) => element.getAttribute("datetime") ?? "", renderHTML: (attrs) => ({ datetime: attrs.date }) } }),
  parseHTML: () => [{ tag: "time[datetime]" }],
  renderHTML: ({ HTMLAttributes, node }) => ["time", HTMLAttributes, node.attrs.date],
  renderText: ({ node }) => node.attrs.date,
  markdownTokenName: "paperDate",
  markdownTokenizer: {
    name: "paperDate", level: "inline", start: (src) => src.search(/(?<![\w-])\d{4}-\d{2}-\d{2}(?![\w-])/),
    tokenize: (src) => { const found = ISO.exec(src); return found && isDay(found[0]) ? { type: "paperDate", raw: found[0], date: found[0] } : undefined; },
  },
  parseMarkdown: (token, h) => h.createNode("date", { date: token.date }),
  renderMarkdown: (node) => node.attrs?.date ?? "",
});

/** The inks text may wear, named as Markup names them (components/ui/markup.tsx MARKUP_INKS) and never a colour, so each theme draws its own; plain is no mark. */
export const PAPER_INKS = ["red", "amber", "green", "blue"];
/**
 * Text in an ink (`color`, `<span data-color="red">…</span>`) or washed in one (`highlight`, `<mark data-color="amber">…</mark>`). Either with an ink
 * not in PAPER_INKS is read as its words alone.
 */
const inked = (name, tag) => {
  const token = `paper-${name}`, found = new RegExp(`^<${tag} data-color="([^"<>]*)">([\\s\\S]*?)</${tag}>`);
  return Mark.create({
    name,
    addAttributes: () => ({ ink: { default: null, parseHTML: (element) => element.getAttribute("data-color"), renderHTML: (attrs) => ({ "data-color": attrs.ink }) } }),
    parseHTML: () => [{ tag: `${tag}[data-color]`, getAttrs: (element) => PAPER_INKS.includes(element.getAttribute("data-color")) && null }],
    renderHTML: ({ HTMLAttributes }) => [tag, HTMLAttributes, 0],
    markdownTokenName: token,
    markdownTokenizer: { name: token, level: "inline", start: (src) => src.indexOf(`<${tag} data-color="`), tokenize: (src, _tokens, lexer) => { const at = found.exec(src); return at ? { type: token, raw: at[0], ink: at[1], tokens: lexer.inlineTokens(at[2]) } : undefined; } },
    parseMarkdown: (token, h) => PAPER_INKS.includes(token.ink) ? h.applyMark(name, h.parseInline(token.tokens ?? []), { ink: token.ink }) : h.parseInline(token.tokens ?? []),
    renderMarkdown: (node, h) => `<${tag} data-color="${node.attrs?.ink}">${h.renderChildren(node)}</${tag}>`,
  });
};

// No trailing block: an editor that adds one writes it into the hub's copy, once for each page that has the document open.
export const documentExtensions = () => [StarterKit.configure({ undoRedo: false, trailingNode: false, link: { openOnClick: false } }), TaskList, TaskItem.configure({ nested: true }), TableKit, Image, Callout, Toggle, Day, inked("color", "span"), inked("highlight", "mark"), UniqueID.configure({ types: BLOCK_TYPES, generateID: blockId })];

/*
 * The live socket (/v0/document/<id>/live) carries binary frames, the first byte saying which: `have` is a Yjs state
 * vector ("this is what I hold: send what I lack") and `update` a Yjs update. A text frame is the client naming itself,
 * { client, name, format }, which it sends first; the hub answers with `have`, then each side answers one with an update
 * and sends each change as it is made. `format` is FORMAT: an editor built for another drops the blocks, and the text in marks,
 * it cannot draw and writes that back, so the hub lets in only this one.
 */
export const FORMAT = 3;
/** `seats` is not Yjs: its bytes are JSON, the agents at work in the document now (server/documents.js: a seat), told whole each time one changes and never kept. */
export const FRAME = { have: 0, update: 1, seats: 2 };
export const frame = (kind, bytes) => { const out = new Uint8Array(bytes.length + 1); out[0] = kind; out.set(bytes, 1); return out; };
