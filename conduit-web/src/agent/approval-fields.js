/*
 * What a call sends, as labelled fields for an approval card: `{ to: ["rhys@…"], subject: "Thursday" }` reads
 * "To rhys@…", "Subject Thursday". Nested objects name their fields by their parent (`start.dateTime` → "Start",
 * `requestBody.summary` → "Summary"); a list of people reads by their address or name; a Gmail `raw` message is
 * decoded to its headers and body. Nothing is dropped silently: past the cap, the rest is counted.
 */
const MAX_FIELDS = 10;
const MAX_VALUE = 600;
/** Wrappers whose name says nothing about what they hold. */
const WRAPPERS = new Set(["input", "requestBody", "resource", "body", "params", "payload", "data", "message"]);
const PERSON_KEYS = ["email", "emailAddress", "address", "name", "displayName", "id"];
/** Fields that only say "when" under their parent: `start.dateTime` reads "Start". */
const WHEN = new Set(["dateTime", "date"]);
/** The account's own defaults (`userId: "me"`, `calendarId: "primary"`) say nothing. */
const SELF = /^(?:me|primary|self)$/;
const ISO = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

const wordsOf = (key) => String(key).split(/[^A-Za-z0-9]+/).flatMap((part) => part.split(/(?<=[a-z0-9])(?=[A-Z])/)).filter(Boolean);
const labelOf = (key) => { const words = wordsOf(key).join(" ").toLowerCase(); return words ? words[0].toUpperCase() + words.slice(1) : String(key); };
const clip = (text) => text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE - 1)}…` : text;
const compact = (value) => { try { return JSON.stringify(value); } catch { return String(value); } };

/** A Gmail `raw` (base64url RFC 822): its To/Cc/Bcc/Subject headers and plain body; null when it is not one. */
function mimeFields(raw) {
  if (typeof raw !== "string" || raw.length < 24 || !/^[A-Za-z0-9_-]+={0,2}$/.test(raw)) return null;
  const text = Buffer.from(raw, "base64url").toString("utf8");
  const split = text.search(/\r?\n\r?\n/);
  if (split < 0 || !/^[\w-]+:/.test(text)) return null;
  const headers = text.slice(0, split).replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/);
  const fields = [];
  for (const name of ["To", "Cc", "Bcc", "Subject"]) {
    const line = headers.find((header) => header.toLowerCase().startsWith(`${name.toLowerCase()}:`));
    if (line) fields.push({ label: name, value: clip(line.slice(name.length + 1).trim()) });
  }
  const body = text.slice(split).trim();
  // A multipart body is shown as it is; only its first text part would mislead about what else it carries.
  if (body) fields.push({ label: "Body", value: clip(body) });
  return fields;
}

function valueText(value) {
  if (typeof value !== "object") { const when = ISO.exec(String(value)); return when ? `${when[1]} ${when[2]}${when[3] ? ` ${when[3]}` : ""}` : String(value); }
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item === null || typeof item !== "object") return String(item);
      const key = PERSON_KEYS.find((name) => typeof item[name] === "string");
      return key ? item[key] : compact(item);
    }).join(", ");
  }
  return compact(value);
}

/** The fields of one call's input; [] for nothing to show. */
export function fieldsOf(input) {
  const out = [];
  const visit = (value, label, depth) => {
    if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) return;
    if (typeof value === "object" && !Array.isArray(value)) {
      const entries = Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== "");
      if (!entries.length) return;
      // One plain value inside names it by its parent: `start: { dateTime }` → "Start".
      if (label && entries.length === 1 && (typeof entries[0][1] !== "object" || entries[0][1] === null)) return visit(entries[0][1], label, depth);
      if (depth >= 3) return out.push({ label: label || "Input", value: clip(compact(value)) });
      for (const [key, item] of entries) {
        if (key === "raw") { const mime = mimeFields(item); if (mime) { out.push(...mime); continue; } }
        if (/Id$/.test(key) && typeof item === "string" && SELF.test(item)) continue;
        // A wrapper (`requestBody`) adds no name and no depth; a "when" takes its parent's.
        if (WHEN.has(key) && label) visit(item, label, depth + 1);
        else if (WRAPPERS.has(key) && item && typeof item === "object" && !Array.isArray(item)) visit(item, label, depth);
        else visit(item, label ? `${label} ${labelOf(key).toLowerCase()}` : labelOf(key), depth + 1);
      }
      return;
    }
    out.push({ label: label || "Input", value: clip(valueText(value)) });
  };
  visit(input, "", 0);
  return out.length > MAX_FIELDS ? [...out.slice(0, MAX_FIELDS - 1), { label: "And", value: `${out.length - MAX_FIELDS + 1} more fields` }] : out;
}

/** Fields as one line of text, for a notification: "To rhys@…, Subject Thursday". */
export const fieldsText = (fields, max = 200) => clip(fields.map(({ label, value }) => `${label} ${value}`).join(", ")).slice(0, max);
