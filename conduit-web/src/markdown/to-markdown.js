import path from "node:path";

/*
 * Conduit's one way to turn anything into Markdown: HTML, PDF (its text), Word, Excel, PowerPoint, EPUB, CSV, JSON and
 * plain text. markit (a Rust engine in-process, no model and no network) does the work; this is the only file that
 * knows it, so another engine is a change here alone.
 */
let engine = null;

/** The extensions a content type is converted as, where the name gives none. */
const EXTENSIONS = {
  "text/html": ".html", "application/xhtml+xml": ".html", "text/plain": ".txt", "text/markdown": ".md", "text/csv": ".csv",
  "application/json": ".json", "application/pdf": ".pdf", "application/epub+zip": ".epub", "application/xml": ".xml", "text/xml": ".xml",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
};
/** What is worth converting: documents and text, not images, audio or archives. */
const CONVERTIBLE = new Set([".html", ".htm", ".txt", ".md", ".csv", ".tsv", ".json", ".pdf", ".epub", ".xml", ".docx", ".xlsx", ".pptx"]);

const extensionOf = ({ type, name }) => {
  const own = name ? path.extname(String(name)).toLowerCase() : "";
  if (own) return own;
  return EXTENSIONS[String(type || "").split(";")[0].trim().toLowerCase()] || "";
};

/** Whether `toMarkdown` turns this into text: a document or text, by its name or content type. */
export const convertible = (info = {}) => CONVERTIBLE.has(extensionOf(info));

/**
 * `input` (bytes or text) as Markdown; `type` its content type, `name` its file name (either says what it is).
 * Throws when the format is not one it reads.
 */
export async function toMarkdown(input, { type, name } = {}) {
  // Loaded on first use: its native build covers Linux and macOS, so a hub elsewhere starts, and only converting fails.
  engine ??= new (await import("@shiftlabs/markit")).Markit();
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(String(input ?? ""), "utf8");
  const extension = extensionOf({ type, name });
  const { markdown } = await engine.convert(bytes, { ...(extension ? { extension } : {}), ...(type ? { mimetype: String(type).split(";")[0].trim() } : {}), ...(name ? { filename: String(name) } : {}) });
  return String(markdown || "").replace(/\r/g, "").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}
