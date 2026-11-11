import fs from "node:fs/promises";
import path from "node:path";

const INLINE_TEXT_BYTES = 256 * 1024;

/**
 * A harness on a device cannot open this server's attachment paths, so anything not inlined is said to be out of the
 * tools' reach and the model does not try a path that names nothing there.
 */
export async function attachmentForDevice(item) {
  const name = item.name || path.basename(item.path);
  const bytes = await fs.readFile(item.path).catch(() => null);
  const text = bytes && bytes.length <= INLINE_TEXT_BYTES && !bytes.includes(0) ? bytes.toString("utf8") : null;
  return text !== null && !text.includes("�")
    ? `Attached file ${name}:\n\`\`\`\`\n${text}\n\`\`\`\``
    : `Attached file ${name} is kept on the Conduit server and cannot be opened from this device's tools.`;
}

export async function imageDataUrl(item) {
  return `data:${item.type || item.mimeType};base64,${(await fs.readFile(item.path)).toString("base64")}`;
}
