import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import PostalMime from "postal-mime";
import { parseDocument } from "htmlparser2";
import { removeElement } from "domutils";
import render from "dom-serializer";
import YAML from "yaml";
import { splitQuoted } from "../email-quote.js";
import { convertible, toMarkdown } from "../markdown/to-markdown.js";

/*
 * One way an email becomes something jbot reads, whichever way it came: mail to jbot's own address (email.js) and the
 * person's Gmail, gathered by the heartbeat's email task (mail-task.js). PostalMime unpacks the message (headers, parts,
 * encodings, attachments); the HTML body, cleaned of what a reader never sees, and each document attachment go through
 * toMarkdown. Everything lands in jbot's folder under mail/<date>/<id>/:
 *
 *   message.eml     the original, byte for byte
 *   message.html    its HTML part, when it has one
 *   message.md      front matter (subject, from, to, cc, date, message id, and what the source adds: labels, a link,
 *                   the thread) and the body as Markdown
 *   <attachment>    each attachment, and <attachment>.md beside a document one
 *
 * The folder is named by the Message-ID, so one email reaching jbot both ways is one folder.
 */
const BODY_MAX = 200_000;
const ATTACHMENT_CONVERT_MAX = 15 * 1024 * 1024;
const GIST_MAX = 220;

const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
export const safeName = (name) => String(name || "attachment").replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "attachment";
export const named = (party) => party?.name ? `${party.name} <${party.address}>` : party?.address || "";
/** Where an email's files go, relative to jbot's folder. */
export const mailDir = (messageId, at) => path.join("mail", at.slice(0, 10), sha(messageId).slice(0, 10));

/** What a reader never sees in an email: hidden preheaders, tracking pixels, scripts and styles. */
const HIDDEN = /display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all|max-height\s*:\s*0(?![.\d])|opacity\s*:\s*0(?![.\d])/i;
export const INVISIBLE = /[\u034F\u00AD\u180E\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g;
export function cleanEmailHtml(html) {
  const doc = parseDocument(String(html || ""));
  const walk = (nodes) => {
    for (const node of [...nodes]) {
      if (node.type === "script" || node.type === "style" || node.type === "comment" || node.type === "directive") { removeElement(node); continue; }
      if (node.type !== "tag") continue;
      const name = node.name.toLowerCase();
      const attribs = node.attribs || {};
      const pixel = name === "img" && (/^[01](px)?$/.test(attribs.width || "") || /^[01](px)?$/.test(attribs.height || "")
        || /(width|height)\s*:\s*[01]px/i.test(attribs.style || ""));
      if (["head", "title", "meta", "link", "noscript", "template"].includes(name) || pixel || HIDDEN.test(attribs.style || "") || "hidden" in attribs) {
        removeElement(node); continue;
      }
      walk(node.children || []);
    }
  };
  walk(doc.children);
  unwrapLayout(doc.children);
  return render(doc).replace(INVISIBLE, "");
}

/**
 * Email lays itself out with tables, nested deep; as Markdown they become tables of tables. A table is kept only when
 * it holds data: header cells, nothing nested, more than one column. The rest become plain blocks, rows and cells
 * alike, so what they hold reads in order.
 */
const LAYOUT = new Set(["table", "tbody", "thead", "tfoot", "tr", "td", "th", "center"]);
const descendants = (node, test) => (node.children || []).some((child) => child.type === "tag" && (test(child) || descendants(child, test)));
const isData = (table) => descendants(table, (node) => node.name === "th") && !descendants(table, (node) => node.name === "table")
  && (table.attribs?.role || "").toLowerCase() !== "presentation"
  && descendants(table, (node) => node.name === "tr" && (node.children || []).filter((cell) => cell.type === "tag" && ["td", "th"].includes(cell.name)).length > 1);
function unwrapLayout(nodes) {
  for (const node of nodes) {
    if (node.type !== "tag") continue;
    if (node.name === "table" && isData(node)) continue;
    if (LAYOUT.has(node.name)) { node.name = "div"; node.attribs = {}; }
    unwrapLayout(node.children || []);
  }
}

/** The first line of its own words that says something: not an image, a lone link, or a greeting on its own. */
function gistOf(text) {
  for (const line of String(text || "").split(/\n+/)) {
    const plain = line.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#>*_`|\\-]+/g, " ").replace(/\s+/g, " ").trim();
    // Words outside any link: a row of links (a menu, "View online") says nothing about the email.
    const own = line.replace(/!?\[[^\]]*\]\([^)]*\)/g, "").replace(/[#>*_`|\\-]+/g, " ").replace(/\s+/g, " ").trim();
    if (plain.length < 12 || own.length < 12 || /^(hi|hello|hey|dear)\b[^.!?]{0,40}[,!]?$/i.test(plain)) continue;
    return plain.length > GIST_MAX ? `${plain.slice(0, GIST_MAX - 1)}…` : plain;
  }
  return "";
}

/**
 * An email (its raw RFC 822 bytes) read and kept: `meta` is what its source knows beyond the message (labels, link,
 * thread, account). Returns what callers tell jbot: its parties, its Markdown, its own words apart from what it quotes,
 * a one-line gist, its files. Writes nothing when `folder` is null; no message.eml when `original` is false (a message
 * put back together from parts is not the original).
 */
export async function readMail(raw, { folder = null, meta = {}, original = true } = {}) {
  const mail = await PostalMime.parse(raw);
  const messageId = mail.messageId || `<${sha(raw).slice(0, 32)}@conduit>`;
  const at = mail.date && !Number.isNaN(Date.parse(mail.date)) ? new Date(mail.date).toISOString() : new Date().toISOString();
  const dir = mailDir(messageId, at);
  const html = mail.html ? cleanEmailHtml(mail.html) : "";
  let markdown = "";
  if (html) markdown = await toMarkdown(html, { type: "text/html" }).catch(() => "");
  if (!markdown) markdown = String(mail.text || "").replace(/\r/g, "").trim();
  markdown = markdown.replace(INVISIBLE, "");
  if (markdown.length > BODY_MAX) markdown = `${markdown.slice(0, BODY_MAX)}\n\n[… cut here: the rest is in message.eml]`;
  const { own, quoted } = splitQuoted(markdown);

  const attachments = [];
  const where = folder ? path.join(folder, dir) : null;
  if (where) await fs.mkdir(where, { recursive: true });
  for (const attachment of mail.attachments || []) {
    const filename = safeName(attachment.filename);
    const content = typeof attachment.content === "string"
      ? Buffer.from(attachment.content, attachment.encoding === "base64" ? "base64" : "utf8") : Buffer.from(attachment.content);
    const item = { filename, mimeType: attachment.mimeType, size: content.length, path: path.join(dir, filename) };
    if (where) {
      await fs.writeFile(path.join(where, filename), content);
      if (content.length <= ATTACHMENT_CONVERT_MAX && convertible({ name: filename, type: attachment.mimeType })) {
        const text = await toMarkdown(content, { name: filename, type: attachment.mimeType }).catch(() => "");
        if (text) { await fs.writeFile(path.join(where, `${filename}.md`), `${text}\n`); item.markdown = path.join(dir, `${filename}.md`); }
      }
    }
    attachments.push(item);
  }

  const header = {
    subject: mail.subject || "(no subject)",
    from: named(mail.from),
    ...(mail.to?.length ? { to: mail.to.map(named) } : {}),
    ...(mail.cc?.length ? { cc: mail.cc.map(named) } : {}),
    date: at,
    "message-id": messageId,
    ...Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== undefined && value !== null && value !== ""
      && !(Array.isArray(value) && !value.length))),
    ...(attachments.length ? { attachments: attachments.map((item) => item.filename) } : {}),
  };
  if (where) {
    if (original) await fs.writeFile(path.join(where, "message.eml"), raw);
    if (mail.html) await fs.writeFile(path.join(where, "message.html"), mail.html);
    await fs.writeFile(path.join(where, "message.md"), `---\n${YAML.stringify(header, { lineWidth: 0 })}---\n\n${markdown}\n`);
  }
  return { mail, messageId, at, dir, header, markdown, own: own || markdown, quoted: Boolean(own && quoted), gist: gistOf(own || markdown), attachments };
}
