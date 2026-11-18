import PostalMime from "postal-mime";
import { Parser, parseDocument } from "htmlparser2";
import { removeElement } from "domutils";
import render from "dom-serializer";
import { readMail } from "../agent/mail-pipeline.js";
import { splitQuoted } from "../email-quote.js";

const SKIP = new Set(["script", "style", "head", "title"]);
const BREAK = new Set(["br", "p", "div", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table", "blockquote"]);

/* For search and the snippet only, so tags are dropped rather than read as Markdown. */
export function htmlText(html) {
  const out = [];
  let skipping = 0;
  const parser = new Parser({
    onopentagname: (name) => { if (SKIP.has(name)) skipping++; else if (BREAK.has(name)) out.push("\n"); },
    onclosetag: (name) => { if (SKIP.has(name)) skipping--; else if (BREAK.has(name)) out.push("\n"); },
    ontext: (text) => { if (!skipping) out.push(text); },
  }, { decodeEntities: true });
  parser.end(String(html || ""));
  return out.join("").replace(/[ \t ]+/g, " ").replace(/ *\n[\n ]*/g, "\n").trim();
}

const holdable = (mail) => ({
  // The HTML part first: a sender's plain part is often its markup or bare tracking links.
  text: (mail.html && htmlText(mail.html)) || (mail.text || "").replace(/\r/g, "").trim(),
  attachments: mail.attachments.some((attachment) => attachment.disposition !== "inline" || !attachment.related),
});
const bytes = (part) => typeof part.content === "string"
  ? Buffer.from(part.content, part.encoding === "base64" ? "base64" : "utf8") : Buffer.from(part.content);

/** What `holdBody` takes: cheap enough to run for every message a sync reads. */
export const parseMail = async (raw) => holdable(await PostalMime.parse(raw));

/*
 * What is taken out of a message shown as sent: what could act or leave the frame:
 * handlers, script URLs, frames, embeds, forms (their content kept) and anything that changes where links resolve.
 */
const DROP = new Set(["iframe", "frame", "frameset", "object", "embed", "applet", "base", "meta", "link", "script", "input", "button", "select", "textarea", "portal"]);
const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "xlink:href", "background", "poster", "data", "srcset", "lowsrc", "dynsrc", "ping"]);
export function safeHtml(html) {
  const doc = parseDocument(html);
  const walk = (nodes) => {
    for (const node of [...nodes]) {
      if (node.type === "script" || node.type === "directive") { removeElement(node); continue; }
      if (node.type !== "tag") continue;
      const name = node.name.toLowerCase();
      // A one-pixel picture is only there to report the message was opened.
      const pixel = name === "img" && (/^[01](px)?$/.test(node.attribs.width || "") || /^[01](px)?$/.test(node.attribs.height || "") || /(width|height)\s*:\s*[01]px/i.test(node.attribs.style || ""));
      if (DROP.has(name) || pixel) { removeElement(node); continue; }
      if (name === "form") node.name = "div";
      for (const attribute of Object.keys(node.attribs)) {
        const key = attribute.toLowerCase();
        // Browsers ignore control characters and spaces inside a scheme, so "java\tscript:" still runs.
        const value = node.attribs[attribute].replace(/[\u0000-\u0020]+/g, "").toLowerCase();
        if (key.startsWith("on") || key === "srcdoc" || key === "formaction" || key === "action"
          || (URL_ATTRIBUTES.has(key) && /^(javascript|vbscript|data:text\/html|data:image\/svg)/.test(value))) delete node.attribs[attribute];
      }
      walk(node.children || []);
    }
  };
  walk(doc.children);
  return render(doc);
}
// Read as text: pictures are in Original, and a remote one would tell its sender the message was opened.
const withoutImages = (markdown) => markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[\s*\]\([^)]*\)/g, "").replace(/\n{3,}/g, "\n\n").trim();
// A picture a message carries with it (src="cid:…") is put in its place as data: the frame can load nothing from the hub, and nothing is told to anyone by showing it.
const INLINE_MOST = 8 * 1024 * 1024;
function inlined(html, attachments) {
  let room = INLINE_MOST;
  const carried = new Map(attachments.filter((part) => part.contentId && /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(part.mimeType))
    .map((part) => [part.contentId.replace(/^<|>$/g, "").toLowerCase(), part]));
  return carried.size ? html.replace(/cid:([^"'\s)>]+)/gi, (whole, id) => {
    const part = carried.get(decodeURIComponent(id).toLowerCase()), data = part && bytes(part);
    if (!data || data.length > room) return whole;
    room -= data.length;
    return `data:${part.mimeType.toLowerCase()};base64,${data.toString("base64")}`;
  }) : html;
}
/** A message as the pane reads it (MailBody without `message`), and what `holdBody` takes from the same parse. */
export async function readBody(raw) {
  const read = await readMail(raw);
  const { quoted } = splitQuoted(read.markdown);
  return {
    markdown: withoutImages(read.quoted ? read.own : read.markdown),
    quoted: read.quoted ? quoted : "",
    // As sent, its own styles and layout kept: cleanEmailHtml is for reading it as Markdown, and strips both.
    html: read.mail.html ? safeHtml(inlined(read.mail.html, read.mail.attachments)) : null,
    attachments: read.attachments.map((item, index) => ({ index, filename: item.filename, mimeType: item.mimeType, size: item.size })),
    hold: holdable(read.mail),
  };
}

/** One attachment's bytes, by its index in readBody's list. */
export async function attachmentOf(raw, index) {
  const part = (await PostalMime.parse(raw)).attachments[index];
  return part ? bytes(part) : null;
}
