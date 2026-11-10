import fs from "node:fs";
import path from "node:path";

/*
 * Settings search's index, read from the settings source at build time (virtual:settings-index), so a setting is
 * findable the moment it is written and never through a list kept by hand. A section is the region of settings-core.tsx
 * under `<Show when={section() === "id"}>`. In it:
 *   - every row (SettingLine, Switch, SettingCredential, SettingLink, SettingDetails, RuleList) is an entry
 *     under the Group whose title came last, named by its label: a literal, or every string a label expression can be;
 *   - every Group is an entry too, named by its title;
 *   - an entry's words are what else it says (its title, state, placeholder, its options and its buttons), so a search
 *     for "H.265" or "Clear data" finds the row that holds it;
 *   - a table of rows declared outside the markup (`const TOOLS = [{ key, label, title }]`) is entered where it is used.
 * A component a section draws from another settings file (<UsageSettings />, agentSettings.Page) brings that file's
 * entries into the section; one drawn in parts (`<DevicesSettingsTile part="device" />`) brings only the rows under its
 * `props.part === "device"` Shows and those under none. What only the running app knows (provider accounts, shortcut
 * commands, documents) is added there (settings-core.tsx).
 */
const ROWS = ["SettingLine", "Switch", "SettingCredential", "SettingLink", "SettingDetails", "RuleList"];
const TAG = new RegExp(`<(${[...ROWS, "Group"].join("|")})\\b`, "g");

/** Where the tag opened at `from` ends (its `>` outside every brace and quote). */
function tagEnd(source, from) {
  let depth = 0;
  let quote = "";
  for (let at = from; at < source.length; at++) {
    const char = source[at];
    if (quote) { if (char === quote && source[at - 1] !== "\\") quote = ""; continue; }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (char === ">" && depth === 0 && source[at - 1] !== "=") return at;
  }
  return source.length;
}

/** An attribute's strings: its literal, or every quoted string its expression holds (a template's slots dropped). */
function attribute(tag, name) {
  const at = tag.search(new RegExp(`\\s${name}=`));
  if (at < 0) return [];
  const start = at + name.length + 2;
  if (tag[start] === '"') return [tag.slice(start + 1, tag.indexOf('"', start + 1))];
  if (tag[start] !== "{") return [];
  let depth = 0;
  let end = start;
  for (; end < tag.length; end++) { if (tag[end] === "{") depth++; else if (tag[end] === "}" && --depth === 0) break; }
  const expression = tag.slice(start + 1, end);
  const found = [];
  for (const match of expression.matchAll(/"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    // A template's fixed words stand only where they lead it ("Share folders with ${server}"), trimmed of what joined them on.
    const template = match[2] !== undefined && match[2].includes("${");
    if (template && match[2].trimStart().startsWith("${")) continue;
    const text = (match[1] ?? match[2]).replace(/\$\{[\s\S]*$/, "").replace(/\s+/g, " ").replace(/[\s·:(–-]+$/, "").trim();
    if (text) found.push(text);
  }
  return found;
}
// A name a person would look for: it starts as a name does (a capital, or one word like skills.sh), and is not a state ("Listening…").
const readable = (text) => text.length >= 2 && text.length <= 80 && (/^[A-Z]/.test(text) || /^[a-z]\w*\.\w+$/.test(text)) && !/[…:]$/.test(text);
/** What a stretch of markup says besides its rows' names: option and button text, option tables written in place. */
function saidIn(markup, maps) {
  const said = [];
  // A button's words, whatever stands before them inside it (a spinner).
  for (const match of markup.matchAll(/([A-Z][^<>{}]{2,40})<\/Button>/g)) said.push(match[1].trim());
  // A table of what its options are called (`const CODEC_LABELS = { h265: "H.265" }`), used here.
  for (const [name, values] of maps ?? []) if (new RegExp(`\\b${name}\\b`).test(markup)) said.push(...values);
  for (const match of markup.matchAll(/<(?:option|Button|SettingValue|MenuRadioItem)\b[^>]*>([^<>{}]{2,60})<\//g)) said.push(match[1].trim());
  for (const match of markup.matchAll(/\blabel: "([^"]{2,60})"/g)) said.push(match[1]);
  return said;
}

// A component a settings file defines for itself (`function ApprovalRules() {` … `\n}`): its rows belong where it is
// drawn (`<ApprovalRules />`), under that place's group, not where it is written.
const LOCAL = /\nfunction ([A-Z][A-Za-z]+)\([\s\S]*?\n\}/g;
const DRAWN = /(?:<|\{)([A-Za-z]+)(?=[\s/>(])/g;
const HELPER = /\n  const ([a-z][A-Za-z]+) = \([^)]*\)(?::[^=\n]+)? => [\s\S]*?(?=\n  (?:const|let|return|function|createEffect|onMount|onCleanup|\/\/|\/\*)[ (])/g;
// A table declared at the top of a file: rows where its objects carry a key or a title, else a row's options.
const TABLE = /\nconst ([A-Z][A-Z_]+)(?::[^=]+)?= \[([\s\S]*?)\n\];/g;

/** The file's maps of names (`const SOURCE = { off: "Off", local: "Local" }`): name -> what they say. */
function mapsOf(source) {
  const maps = new Map();
  for (const [, name, body] of source.matchAll(/\nconst ([A-Z][A-Z_]+)(?::[^=]+)?= \{([^;]*?)\}(?: as const)?;/g)) {
    const values = [...body.matchAll(/: "([^"]{2,40})"/g)].map((match) => match[1]);
    if (values.length) maps.set(name, values);
  }
  return maps;
}

function tablesOf(source) {
  const tables = new Map();
  for (const [, name, body] of source.matchAll(TABLE)) {
    const items = [...body.matchAll(/\{[^{}]*\blabel: "([^"]{2,80})"[^{}]*\}/g)].map((match) => ({
      label: match[1], words: [...match[0].matchAll(/\b(?:title|description): "([^"]+)"/g)].map((word) => word[1]),
      row: /\b(?:key|title):/.test(match[0]),
    }));
    if (items.length) tables.set(name, items);
  }
  return tables;
}

function entriesOf(source, section, group = null, locals = null, tables = null, depth = 0, maps = null) {
  if (!locals) {
    tables = tablesOf(source);
    maps = mapsOf(source);
    locals = new Map([...source.matchAll(LOCAL)].map((match) => [match[1], match[0]]));
    for (const body of locals.values()) source = source.replace(body, "");
    // A helper a component keeps for itself (`const here = (device) => <>…`): its rows too belong where it is called
    // (`{here(device())}`), which a part's Show may leave out.
    for (const match of [...source.matchAll(HELPER)]) {
      const rows = TAG.test(match[0]);
      TAG.lastIndex = 0;
      if (!rows) continue;
      locals.set(match[1], match[0]);
      source = source.replace(match[0], "");
    }
  }
  const entries = [];
  const marks = [...source.matchAll(TAG)].map((match) => ({ at: match.index, kind: match[1] }))
    .concat([...source.matchAll(DRAWN)].filter((match) => locals.has(match[1])).map((match) => ({ at: match.index, local: match[1] })))
    .concat([...tables.keys()].flatMap((name) => [...source.matchAll(new RegExp(`\\beach=\\{${name}\\b`, "g"))].map((match) => ({ at: match.index, table: name }))))
    .sort((a, b) => a.at - b.at);
  let last = null;
  marks.forEach((mark, index) => {
    if (mark.local) {
      if (depth >= 3) return;
      const inside = entriesOf(locals.get(mark.local), section, group, locals, tables, depth + 1, maps);
      // A piece with no rows of its own (a row's control) lends what it says to the row it sits in.
      if (!inside.length && last) last.words = `${last.words ?? ""} ${saidIn(locals.get(mark.local), maps).join(" ")}`.trim();
      entries.push(...inside);
      return;
    }
    if (mark.table) {
      const items = tables.get(mark.table);
      if (items.some((item) => item.row)) for (const item of items) entries.push({ section, group, label: item.label, words: item.words.join(" ") });
      else if (last) last.words = `${last.words} ${items.map((item) => item.label).join(" ")}`.trim();
      return;
    }
    const end = tagEnd(source, mark.at);
    const tag = source.slice(mark.at, end);
    const after = source.slice(end, marks[index + 1]?.at ?? source.length);
    if (mark.kind === "Group") {
      const titles = attribute(tag, "title").filter(readable);
      if (!titles.length) return;
      group = titles[0];
      for (const title of titles) entries.push(last = { section, group: null, label: title, words: [...attribute(tag, "scope"), ...saidIn(after, maps)].join(" ") });
      return;
    }
    const names = [...attribute(tag, "label"), ...attribute(tag, "name"), ...attribute(tag, "summary")].filter(readable);
    const words = [...attribute(tag, "title"), ...attribute(tag, "state"), ...attribute(tag, "placeholder"), ...saidIn(tag, maps), ...saidIn(after, maps)].join(" ");
    if (!names.length) { if (last && words) last.words = `${last.words} ${words}`.trim(); return; }
    for (const name of new Set(names)) entries.push(last = { section, group, label: name, words });
  });
  return entries;
}

/** The source as one part of a component drawn in parts sees it: the Shows of every other part blanked. */
function partOf(source, part) {
  let out = source;
  for (const match of source.matchAll(/<Show when=\{props\.part === "([a-z]+)"/g)) {
    if (match[1] === part) continue;
    let depth = 0;
    let end = source.length;
    for (const step of source.slice(match.index).matchAll(/<Show\b|<\/Show>/g)) {
      depth += step[0] === "</Show>" ? -1 : 1;
      if (depth === 0) { end = match.index + step.index + step[0].length; break; }
    }
    out = out.slice(0, match.index) + " ".repeat(end - match.index) + out.slice(end);
  }
  return out;
}

// A settings file's own imports from its siblings: name -> file (createAgentSettings also answers to `agentSettings.`).
function importsOf(source) {
  const files = new Map();
  for (const [, names, file] of source.matchAll(/import \{([^}]+)\} from "\.\/([a-z-]+)(?:\.tsx)?";/g)) {
    for (const name of names.split(",").map((item) => item.trim().replace(/^type /, "")).filter(Boolean)) files.set(name, `${file}.tsx`);
  }
  if (files.has("createAgentSettings")) files.set("agentSettings", files.get("createAgentSettings"));
  return files;
}

/** A region's rows, then those of every sibling file a component it draws comes from, followed down (once each). */
function regionEntries(dir, region, section, files, seen) {
  const entries = entriesOf(region, section);
  const drawn = new Map([...region.matchAll(/<([A-Za-z]+)(?:\.Page)?(?=[\s/>])(?:\s+part="([a-z]+)")?/g)].map((match) => [match[1], match[2]]));
  for (const [name, part] of drawn) {
    const file = files.get(name);
    if (!file || file === "settings-core.tsx" || seen.has(file)) continue;
    seen.add(file);
    let source;
    try { source = fs.readFileSync(path.join(dir, file), "utf8"); } catch { continue; }
    entries.push(...regionEntries(dir, part ? partOf(source, part) : source, section, importsOf(source), seen));
  }
  return entries;
}

export function buildSettingsIndex(root) {
  const dir = path.join(root, "src/client/settings");
  const core = fs.readFileSync(path.join(dir, "settings-core.tsx"), "utf8");
  const files = importsOf(core);
  const tables = tablesOf(core);
  const marks = [...core.matchAll(/<Show when=\{section\(\) === "([a-z]+)"\}>/g)].map((match) => ({ id: match[1], at: match.index }));
  const entries = [];
  marks.forEach((mark, index) => {
    // The file's tables are declared above every section: each region reads them as its own.
    const region = core.slice(mark.at, marks[index + 1]?.at ?? core.length);
    const head = [...tables.keys()].filter((name) => region.includes(`each={${name}`)).map((name) => core.match(new RegExp(`\\nconst ${name}\\b[\\s\\S]*?\\n\\];`))?.[0] ?? "").join("");
    entries.push(...regionEntries(dir, head + region, mark.id, files, new Set()));
  });
  const seen = new Set();
  return entries.filter((entry) => { const key = `${entry.section}\0${entry.group}\0${entry.label}`; if (seen.has(key)) return false; seen.add(key); return true; })
    .map((entry) => entry.words ? entry : { section: entry.section, group: entry.group, label: entry.label });
}
