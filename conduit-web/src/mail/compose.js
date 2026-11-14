import MailComposer from "nodemailer/lib/mail-composer";
import PostalMime from "postal-mime";

const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
const address = (party) => party.name ? { name: party.name, address: party.address } : party.address;
const named = (party) => party.name ? `${party.name} <${party.address}>` : party.address;
const escape = (text) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]);

function html(text) {
  const blocks = [];
  for (const line of text.split("\n")) {
    const quoted = /^>/.test(line);
    const content = escape(line.replace(/^> ?/, "")) || "<br>";
    const last = blocks[blocks.length - 1];
    if (last?.quoted === quoted) last.lines.push(content);
    else blocks.push({ quoted, lines: [content] });
  }
  const body = blocks.map((block) => block.quoted
    ? `<blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${block.lines.join("<br>")}</blockquote>`
    : block.lines.map((line) => `<div>${line}</div>`).join("")).join("");
  return `<div dir="auto">${body}</div>`;
}

/**
 * A draft as RFC 822 bytes and its SMTP envelope. `original`: the message it answers (store.message); `forwardRaw`:
 * the raw bytes of the one it passes on, whose attachments go with it. `keepBcc` for the source's drafts, which keep it.
 */
export async function composeDraft(draft, { from, original = null, forwardRaw = null, keepBcc = false }) {
  const attachments = forwardRaw ? (await PostalMime.parse(forwardRaw)).attachments.map((part) => ({
    filename: part.filename || undefined, contentType: part.mimeType, cid: part.contentId?.replace(/^<|>$/g, "") || undefined,
    content: typeof part.content === "string" ? Buffer.from(part.content, part.encoding === "base64" ? "base64" : "utf8") : Buffer.from(part.content),
  })) : [];
  const node = new MailComposer({
    from: address(from), to: draft.to.map(address), cc: draft.cc.map(address), bcc: draft.bcc.map(address),
    subject: draft.subject, text: draft.text, html: html(draft.text), messageId: draft.messageId, date: new Date(),
    ...(original ? { inReplyTo: original.messageId, references: [...original.references, original.messageId] } : {}),
    attachments,
  }).compile();
  node.keepBcc = keepBcc;
  return { raw: await node.build(), envelope: node.getEnvelope() };
}

const when = (date) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(date)).map((part) => [part.type, part.value]));
  return `${parts.weekday}, ${parts.day} ${parts.month} ${parts.year} at ${parts.hour}:${parts.minute}`;
};
const prefixed = (subject, prefix, pattern) => pattern.test(subject) ? subject : `${prefix} ${subject}`;
const unique = (parties, without) => {
  const seen = new Set(without.map((party) => party.address.toLowerCase()));
  return parties.filter((party) => !seen.has(party.address.toLowerCase()) && seen.add(party.address.toLowerCase()));
};

/**
 * What a reply, reply-all or forward starts with. `own`: the account's address, never written to. `text`: the original's
 * plain text (parseMail).
 */
export function prefill(kind, original, { own, text }) {
  const me = [{ name: "", address: own }];
  if (kind === "forward") {
    const header = [
      "---------- Forwarded message ---------",
      `From: ${named(original.from)}`,
      `Date: ${when(original.date)}`,
      `Subject: ${original.subject}`,
      `To: ${original.to.map(named).join(", ")}`,
      ...(original.cc.length ? [`Cc: ${original.cc.map(named).join(", ")}`] : []),
    ];
    return { to: [], cc: [], bcc: [], subject: prefixed(original.subject, "Fwd:", /^(fwd?|fw):/i), text: `\n\n${header.join("\n")}\n\n${text}` };
  }
  const mine = same(original.from.address, own);
  const direct = mine ? original.to : original.replyTo.length ? original.replyTo : [original.from];
  const to = unique(direct, mine ? [] : me);
  const all = kind === "replyAll";
  const quoted = text.split("\n").map((line) => line ? `> ${line}` : ">").join("\n");
  return {
    to: all ? unique([...to, ...original.to], me) : to,
    cc: all ? unique(original.cc, [...me, ...to, ...original.to]) : [],
    bcc: [],
    subject: prefixed(original.subject, "Re:", /^re:/i),
    text: `\n\nOn ${when(original.date)}, ${named(original.from)} wrote:\n${quoted}`,
  };
}
