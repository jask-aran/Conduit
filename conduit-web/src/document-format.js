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
 * was first), by, at }. A change is gone once the person resolves its comment, or it is taken back. A suggestion is kept the same way under a key
 * of its own (`for: "suggestion/<id>"`): a change made in Suggesting, by the person or an agent, that stands until it is accepted (its entries go) or
 * rejected (taken back), whatever happens to the comments.
 */
export const BLOCK_TYPES = ["paragraph", "heading", "blockquote", "codeBlock", "bulletList", "orderedList", "taskList", "listItem", "taskItem", "table", "horizontalRule", "image", "callout", "toggle"];
export const FRAGMENT = "blocks";
export const AUTHORS = "authors";
export const CHANGES = "changes";
export const SUGGESTION = "suggestion/";
export const isSuggestion = (key) => typeof key === "string" && key.startsWith(SUGGESTION);
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
  // An image inside a line of text is asked of this node too (by its name): it stays its Markdown there, as text, since a block cannot stand in a line and its address must not be lost.
  parseMarkdown: (token, h) => token.type === "paperImage" ? h.createNode("image", { src: token.src, alt: token.alt }) : token.raw || token.text ? h.createTextNode(token.raw || token.text) : [],
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
  renderMarkdown: (node, h) => [`[!${String(node.attrs?.tone ?? "note").toUpperCase()}]`, ...h.renderChildren(node.content ?? [], "\n\n").split("\n")].map((line) => line ? `> ${line}` : ">").join("\n"),
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
      // To its own closing tag: a toggle may hold toggles. A tag in code (a fence, a code span) is the code's text; typed in text it is written escaped.
      let depth = 0, end = -1, at = 0, fence = null;
      lines: for (const line of src.split("\n")) {
        const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
        if (fence) { if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null; }
        else if (marker && depth) fence = marker;
        else for (const tag of line.replace(/`+[^`]*`+/g, (code) => " ".repeat(code.length)).matchAll(/<\/?details>/gi)) {
          depth += tag[0][1] === "/" ? -1 : 1;
          if (!depth) { end = at + tag.index + tag[0].length; break lines; }
        }
        at += line.length + 1;
      }
      if (end < 0) return undefined;
      const raw = src.slice(0, end) + (/^[ \t]*(?:\n+|$)/.exec(src.slice(end))?.[0] ?? ""), inner = src.slice(src.indexOf(">") + 1, end - "</details>".length);
      // The summary is written on a line of its own, so a `</summary>` in its code is not its end.
      const summary = /^\s*<summary>(.*)<\/summary>[ \t]*(?=\n|$)/i.exec(inner) ?? /^\s*<summary>([\s\S]*?)<\/summary>/i.exec(inner);
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

/** The inks text may wear, named as Markup names them (components/ui/markup.tsx MARKUP_INKS) so each theme draws its own; plain is no mark. */
export const PAPER_INKS = ["red", "amber", "green", "blue"];
/** Any other colour is written as itself, `#rrggbb`, and is the same in every theme. */
const OWN_INK = /^#[0-9a-f]{6}$/i;
export const paperInk = (ink) => PAPER_INKS.includes(ink) || OWN_INK.test(ink ?? "");
/**
 * Text in an ink (`color`, `<span data-color="red">…</span>`) or washed in one (`highlight`, `<mark data-color="amber">…</mark>`). Either with an ink
 * that is neither (paperInk) is read as its words alone.
 */
const inked = (name, tag) => {
  const token = `paper-${name}`, found = new RegExp(`^<${tag} data-color="([^"<>]*)">([\\s\\S]*?)</${tag}>`);
  return Mark.create({
    name,
    addAttributes: () => ({ ink: { default: null, parseHTML: (element) => element.getAttribute("data-color"), renderHTML: (attrs) => ({ "data-color": attrs.ink, ...(OWN_INK.test(attrs.ink ?? "") ? { style: `--document-ink: ${attrs.ink}` } : {}) }) } }),
    parseHTML: () => [{ tag: `${tag}[data-color]`, getAttrs: (element) => paperInk(element.getAttribute("data-color")) && null }],
    renderHTML: ({ HTMLAttributes }) => [tag, HTMLAttributes, 0],
    markdownTokenName: token,
    markdownTokenizer: { name: token, level: "inline", start: (src) => src.indexOf(`<${tag} data-color="`), tokenize: (src, _tokens, lexer) => { const at = found.exec(src); return at ? { type: token, raw: at[0], ink: at[1], tokens: lexer.inlineTokens(at[2]) } : undefined; } },
    parseMarkdown: (token, h) => paperInk(token.ink) ? h.applyMark(name, h.parseInline(token.tokens ?? []), { ink: token.ink }) : h.parseInline(token.tokens ?? []),
    renderMarkdown: (node, h) => `<${tag} data-color="${node.attrs?.ink}">${h.renderChildren(node)}</${tag}>`,
  });
};

const ITEMS = new Set(["listItem", "taskItem"]);
const imageText = (node) => ({ type: "paragraph", content: [{ type: "text", text: `![${String(node.attrs?.alt ?? "").replace(/[\\\]]/g, "\\$&")}](${node.attrs?.src ?? ""})` }] });
/**
 * Markdown read as blocks (MarkdownManager.parse), made to fit the schema where the list parser does not: an item's text stands in a paragraph, and an
 * image alone in an item is its Markdown as text (an item starts with a line of text, and an empty one would not read back as an item).
 */
export const fitted = (node) => {
  if (!node.content) return node;
  let content = node.content.map(fitted);
  if (ITEMS.has(node.type)) {
    if (content[0]?.type === "paragraph" && !content[0].content?.length && content[1]?.type === "image") content.splice(0, 2, imageText(content[1]));
    else if (content[0]?.type === "image") content[0] = imageText(content[0]);
    const items = [];
    for (const child of content) { const inline = child.type === "text" || child.type === "date"; if (inline && items.at(-1)?.run) items.at(-1).node.content.push(child); else items.push({ node: inline ? { type: "paragraph", content: [child] } : child, run: inline }); }
    content = items.map((item) => item.node);
    if (content[0]?.type !== "paragraph") content.unshift({ type: "paragraph", content: [] });
  }
  return { ...node, content };
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
