const HEADER = '<conduit_attachments version="1">';
const FOOTER = "</conduit_attachments>";

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
  if (!attachments?.length) return String(message || "");
  const rows = attachments.map((attachment) => {
    const relativePath = `.conduit/chats/${chatId}/attachments/${attachment.storedName}`;
    return `<attachment id="${escapeAttribute(attachment.id)}" path="${escapeAttribute(relativePath)}" name="${escapeAttribute(attachment.name)}" />`;
  });
  return `${HEADER}\n${rows.join("\n")}\n${FOOTER}\n\n<user_message>\n${escapeText(message || "")}\n</user_message>`;
}

export function parseAttachmentEnvelope(value) {
  const text = String(value || "");
  if (!text.startsWith(`${HEADER}\n`)) return { message: text, attachments: [] };
  const footerIndex = text.indexOf(`\n${FOOTER}`);
  if (footerIndex < 0) return { message: text, attachments: [] };
  const attachmentBlock = text.slice(HEADER.length + 1, footerIndex);
  const rest = text.slice(footerIndex + FOOTER.length + 1).trim();
  const messageMatch = rest.match(/^<user_message>\n([\s\S]*)\n<\/user_message>$/);
  if (!messageMatch) return { message: text, attachments: [] };
  const attachments = [...attachmentBlock.matchAll(/<attachment\s+id="([^"]+)"\s+path="([^"]+)"\s+name="([^"]*)"\s*\/>/g)]
    .map((match) => ({ id: decodeXml(match[1]), path: decodeXml(match[2]), name: decodeXml(match[3]) }));
  return { message: decodeXml(messageMatch[1]), attachments };
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
