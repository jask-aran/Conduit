import PostalMime from "postal-mime";
import { Parser, parseDocument } from "htmlparser2";
import { removeElement } from "domutils";
import render from "dom-serializer";
import { cleanEmailHtml, readMail } from "../agent/mail-pipeline.js";
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
  text: mail.text?.trim() ? mail.text.replace(/\r/g, "").trim() : htmlText(mail.html),
  attachments: mail.attachments.some((attachment) => attachment.disposition !== "inline" || !attachment.related),
});
const bytes = (part) => typeof part.content === "string"
  ? Buffer.from(part.content, part.encoding === "base64" ? "base64" : "utf8") : Buffer.from(part.content);

/** What `holdBody` takes: cheap enough to run for every message a sync reads. */
export const parseMail = async (raw) => holdable(await PostalMime.parse(raw));

/*
 * cleanEmailHtml takes out scripts, trackers and hidden parts; this takes out what could act or leave the frame:
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
      if (DROP.has(name)) { removeElement(node); continue; }
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
/** A message as the pane reads it (MailBody without `message`), and what `holdBody` takes from the same parse. */
export async function readBody(raw) {
  const read = await readMail(raw);
  const { quoted } = splitQuoted(read.markdown);
  return {
    markdown: read.quoted ? read.own : read.markdown,
    quoted: read.quoted ? quoted : "",
    html: read.mail.html ? safeHtml(cleanEmailHtml(read.mail.html)) : null,
    attachments: read.attachments.map((item, index) => ({ index, filename: item.filename, mimeType: item.mimeType, size: item.size })),
    hold: holdable(read.mail),
  };
}

/** One attachment's bytes, by its index in readBody's list. */
export async function attachmentOf(raw, index) {
  const part = (await PostalMime.parse(raw)).attachments[index];
  return part ? bytes(part) : null;
}
