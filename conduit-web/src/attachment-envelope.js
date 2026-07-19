const FOOTER = "</conduit_attachments>";
const ATTACHMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHAT_ID = /^[a-zA-Z0-9_-]{8,128}$/;

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function decodeXml(value) {
  return String(value)
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");
}

export function serializeAttachmentEnvelope({ chatId, attachments, message }) {
  const rows = (attachments || []).map((attachment) => {
    const relativePath = `.conduit/chats/${chatId}/attachments/${attachment.storedName}`;
    return `<attachment id="${escapeAttribute(attachment.id)}" path="${escapeAttribute(relativePath)}" name="${escapeAttribute(attachment.name)}" />`;
  });
  const header = `<conduit_attachments version="2" chat_id="${escapeAttribute(chatId)}">`;
  return `${header}\n${rows.join("\n")}\n${FOOTER}\n\n<user_message>\n${escapeText(message || "")}\n</user_message>`;
}

export function parseAttachmentEnvelope(value) {
  const text = String(value || "");
  const headerMatch = text.match(/^<conduit_attachments version="([12])"(?: chat_id="([^"]+)")?>\n/);
  if (!headerMatch) return { message: text, attachments: [] };
  const header = headerMatch[0].slice(0, -1);
  const version = headerMatch[1];
  const declaredChatId = headerMatch[2] ? decodeXml(headerMatch[2]) : null;
  if (version === "2" && (!declaredChatId || !CHAT_ID.test(declaredChatId))) return { message: text, attachments: [] };
  const footerIndex = text.indexOf(`\n${FOOTER}`);
  if (footerIndex < 0) return { message: text, attachments: [] };
  const attachmentBlock = text.slice(header.length + 1, footerIndex);
  const rest = text.slice(footerIndex + FOOTER.length + 1).trim();
  const messageMatch = rest.match(/^<user_message>\n([\s\S]*)\n<\/user_message>$/);
  if (!messageMatch) return { message: text, attachments: [] };
  const lines = attachmentBlock ? attachmentBlock.split("\n") : [];
  const matches = lines.map((line) => line.match(/^<attachment\s+id="([^"]+)"\s+path="([^"]+)"\s+name="([^"]*)"\s*\/>$/));
  if (matches.some((match) => !match)) return { message: text, attachments: [] };
  const attachments = matches.map((match) => enrichAttachment({
      id: decodeXml(match[1]),
      path: decodeXml(match[2]),
      name: decodeXml(match[3]),
    }));
  const ids = new Set();
  for (const attachment of attachments) {
    const storedName = attachment.path.split("/").at(-1) || "";
    const expectedPrefix = version === "2" ? `.conduit/chats/${declaredChatId}/attachments/` : ".conduit/chats/";
    if (!ATTACHMENT_ID.test(attachment.id) || ids.has(attachment.id)
      || !attachment.path.startsWith(expectedPrefix) || !storedName.startsWith(`${attachment.id}--`)) {
      return { message: text, attachments: [] };
    }
    ids.add(attachment.id);
  }
  return { message: decodeXml(messageMatch[1]), attachments };
}

export function attachmentChatIdFromPath(pathValue) {
  const match = String(pathValue || "").match(/^\.conduit\/chats\/([^/]+)\/attachments\//);
  return match?.[1] || null;
}

function mimeFromName(name) {
  const extension = String(name || "").split(".").pop()?.toLowerCase() || "";
  return ({
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf", json: "application/json",
    txt: "text/plain", md: "text/markdown", csv: "text/csv",
  })[extension] || "application/octet-stream";
}

export function enrichAttachment(attachment) {
  if (!attachment || typeof attachment !== "object") return attachment;
  const path = attachment.path || "";
  const name = attachment.name || "";
  const chatId = attachment.chatId || attachmentChatIdFromPath(path);
  return {
    ...attachment,
    chatId: chatId || undefined,
    type: attachment.type || mimeFromName(name),
  };
}

export function announcedAttachmentIds(entries) {
  const ids = new Set();
  for (const entry of entries || []) {
    if (entry.type !== "message" || entry.message?.role !== "user") continue;
    for (const attachment of parseAttachmentEnvelope(textContent(entry.message.content)).attachments) ids.add(attachment.id);
  }
  return ids;
}

function textContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((block) => block?.type === "text").map((block) => block.text || "").join("\n");
}
