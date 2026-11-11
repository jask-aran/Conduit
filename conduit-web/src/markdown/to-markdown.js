import path from "node:path";

/* The only file that knows markit, so another engine is a change here alone. */
let engine = null;

const EXTENSIONS = {
  "text/html": ".html", "application/xhtml+xml": ".html", "text/plain": ".txt", "text/markdown": ".md", "text/csv": ".csv",
  "application/json": ".json", "application/pdf": ".pdf", "application/epub+zip": ".epub", "application/xml": ".xml", "text/xml": ".xml",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
};
const CONVERTIBLE = new Set([".html", ".htm", ".txt", ".md", ".csv", ".tsv", ".json", ".pdf", ".epub", ".xml", ".docx", ".xlsx", ".pptx"]);

const extensionOf = ({ type, name }) => {
  const own = name ? path.extname(String(name)).toLowerCase() : "";
  if (own) return own;
  return EXTENSIONS[String(type || "").split(";")[0].trim().toLowerCase()] || "";
};

export const convertible = (info = {}) => CONVERTIBLE.has(extensionOf(info));

export async function toMarkdown(input, { type, name } = {}) {
  // Loaded on first use: its native build covers only Linux and macOS, so a hub elsewhere starts, and only converting fails.
  engine ??= new (await import("@shiftlabs/markit")).Markit();
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(String(input ?? ""), "utf8");
  const extension = extensionOf({ type, name });
  const { markdown } = await engine.convert(bytes, { ...(extension ? { extension } : {}), ...(type ? { mimetype: String(type).split(";")[0].trim() } : {}), ...(name ? { filename: String(name) } : {}) });
  return String(markdown || "").replace(/\r/g, "").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}
