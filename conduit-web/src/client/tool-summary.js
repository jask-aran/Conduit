// Pure helpers for the generic tool-call card v2 (`./tool-card.jsx`), kept in
// their own module so they can be unit-tested with node:test without
// importing any JSX.

const MAX_INLINE_VALUE_LENGTH = 24;
const MAX_SUMMARY_VALUE_LENGTH = 72;
export const MAX_PREVIEW_LENGTH = 4000;
export const MAX_PREVIEW_LINES = 10;

const PATH_KEYS = /^(?:file|fileName|file_path|filename|folder|path|target|targetPath)$/i;
const COMMAND_KEYS = /^(?:cmd|command|executable|script|shell)$/i;
const URL_KEYS = /^(?:href|uri|url)$/i;
const QUERY_KEYS = /^(?:pattern|prompt|query|search|selector)$/i;
const PAYLOAD_KEYS = /^(?:body|content|data|input|payload|text)$/i;

const isScalar = value => value == null || ["string", "number", "boolean"].includes(typeof value);
const normalizeInline = value => String(value ?? "").replace(/\s+/g, " ").trim();

export function truncateValue(value, max = MAX_INLINE_VALUE_LENGTH) {
  if (value == null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text == null) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function compactPath(value) {
  const path = normalizeInline(value).replaceAll("\\", "/");
  if (path.length <= MAX_SUMMARY_VALUE_LENGTH) return path;
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return truncateValue(path, MAX_SUMMARY_VALUE_LENGTH);
  const rawFileName = parts.at(-1) || "";
  const fileName = rawFileName.replace(/^[0-9a-f-]{16,}--(.+)$/i, "$1");
  const parent = parts.at(-2);
  return parent ? `${parent}/${fileName}` : fileName;
}

function summaryValue(key, value) {
  const text = PATH_KEYS.test(key) ? compactPath(value) : normalizeInline(value);
  return truncateValue(text, MAX_SUMMARY_VALUE_LENGTH);
}

function selectSemanticEntry(entries) {
  const scalarEntries = entries.filter(([, value]) => isScalar(value));
  return scalarEntries.find(([key]) => PATH_KEYS.test(key))
    || scalarEntries.find(([key]) => COMMAND_KEYS.test(key))
    || scalarEntries.find(([key]) => URL_KEYS.test(key))
    || scalarEntries.find(([key]) => QUERY_KEYS.test(key))
    || scalarEntries.find(([key]) => !PAYLOAD_KEYS.test(key));
}

/**
 * Derives one compact, Pi-style `name primary` summary. The complete argument
 * object remains available in the expanded Arguments section.
 */
export function summarizeTool(tool) {
  const name = tool?.name || "tool";
  const args = tool?.args;
  if (args == null) return name;
  if (typeof args !== "object" || Array.isArray(args)) {
    const value = truncateValue(normalizeInline(args), MAX_SUMMARY_VALUE_LENGTH);
    return value ? `${name} ${value}` : name;
  }
  const entries = Object.entries(args);
  if (entries.length === 0) return name;
  const primary = selectSemanticEntry(entries);
  if (!primary) return `${name} · +${entries.length}`;
  const [key, value] = primary;
  const detail = summaryValue(key, value);
  const additional = entries.length - 1;
  return `${name}${detail ? ` ${detail}` : ""}${additional > 0 ? ` · +${additional}` : ""}`;
}

/** Pretty-prints a value for the expanded args/result sections. */
export function prettyPrintValue(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function previewValue(value, max = MAX_PREVIEW_LENGTH) {
  const text = prettyPrintValue(value);
  if (text.length <= max) return { text, truncated: false };
  return { text: `${text.slice(0, max)}…`, truncated: true };
}

export function previewToolValue(value, {
  direction = "head",
  maxChars = MAX_PREVIEW_LENGTH,
  maxLines = MAX_PREVIEW_LINES,
} = {}) {
  const fullText = prettyPrintValue(value);
  const lines = fullText.split("\n");
  const visibleLines = direction === "tail" ? lines.slice(-maxLines) : lines.slice(0, maxLines);
  let text = visibleLines.join("\n");
  if (text.length > maxChars) {
    text = direction === "tail" ? text.slice(-maxChars) : text.slice(0, maxChars);
  }
  return {
    text,
    truncated: text !== fullText,
    hiddenChars: Math.max(0, fullText.length - text.length),
    hiddenLines: Math.max(0, lines.length - visibleLines.length),
  };
}

export function toolResultPreviewDirection(tool) {
  const args = tool?.args;
  if (args && typeof args === "object" && !Array.isArray(args)) {
    if (Object.keys(args).some(key => COMMAND_KEYS.test(key))) return "tail";
  }
  return /(?:bash|command|exec|process|run|shell)/i.test(tool?.name || "") ? "tail" : "head";
}

export function formatToolDuration(tool) {
  const startedAt = Date.parse(tool?.startedAt || "");
  const completedAt = Date.parse(tool?.completedAt || "");
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) return "";
  const milliseconds = completedAt - startedAt;
  if (milliseconds < 1000) return `${milliseconds}ms`;
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(1).replace(/\.0$/, "")}s`;
  const wholeSeconds = Math.round(seconds);
  return `${Math.floor(wholeSeconds / 60)}m ${wholeSeconds % 60}s`;
}
