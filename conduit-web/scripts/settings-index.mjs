import fs from "node:fs";
import path from "node:path";

/*
 * Settings search's index, read from the settings source at build time (virtual:settings-index), so a setting is
 * findable the moment it is written and never through a list kept by hand. A section is the region of settings-core.tsx
 * under `<Show when={section() === "id"}>`; in it, every SettingLine, Switch, SettingCredential, SettingLink and RuleList with a
 * literal label is an entry, under the Group whose title came last. A component a section draws from another settings
 * file (<UsageSettings />, agentSettings.Page) brings that file's entries into the section. Labels written as
 * expressions are not indexed; the section's own name always is.
 */
// A row's name is its label (a credential's, its name); a group's is its title. A row's title is its tooltip, not its name.
const ROW = /<(SettingLine|Switch|SettingCredential|SettingLink|RuleList)\b[^>]*?\s(?:label|name)="([^"{}]{2,80})"|<Group\b[^>]*?\stitle="([^"{}]{2,80})"/g;

// A component a settings file defines for itself (`function ApprovalRules() {` … `\n}`): its rows belong where it is
// drawn (`<ApprovalRules />`), under that place's group, not where it is written.
const LOCAL = /\nfunction ([A-Z][A-Za-z]+)\([^)]*\)[^{]*\{[\s\S]*?\n\}/g;
const DRAWN = /<([A-Z][A-Za-z]+)\s*\/>/g;

function entriesOf(source, section, group = null, locals = null, depth = 0) {
  if (!locals) {
    locals = new Map([...source.matchAll(LOCAL)].map((match) => [match[1], match[0]]));
    for (const body of locals.values()) source = source.replace(body, "");
  }
  const entries = [];
  const marks = [...source.matchAll(ROW)].map((match) => ({ at: match.index, match }))
    .concat([...source.matchAll(DRAWN)].filter((match) => locals.has(match[1])).map((match) => ({ at: match.index, local: match[1] })))
    .sort((a, b) => a.at - b.at);
  for (const mark of marks) {
    if (mark.local) { if (depth < 3) entries.push(...entriesOf(locals.get(mark.local), section, group, locals, depth + 1)); continue; }
    const [, , row, title] = mark.match;
    if (title) { group = title; continue; }
    entries.push({ section, group, label: row });
  }
  return entries;
}

export function buildSettingsIndex(root) {
  const dir = path.join(root, "src/client/settings");
  const core = fs.readFileSync(path.join(dir, "settings-core.tsx"), "utf8");
  // Imported names -> their settings file (createAgentSettings also answers to `agentSettings.`).
  const files = new Map();
  for (const [, names, file] of core.matchAll(/import \{([^}]+)\} from "\.\/([a-z-]+)";/g)) {
    for (const name of names.split(",").map((item) => item.trim().replace(/^type /, "")).filter(Boolean)) files.set(name, `${file}.tsx`);
  }
  if (files.has("createAgentSettings")) files.set("agentSettings", files.get("createAgentSettings"));
  const marks = [...core.matchAll(/<Show when=\{section\(\) === "([a-z]+)"\}>/g)].map((match) => ({ id: match[1], at: match.index }));
  const entries = [];
  marks.forEach((mark, index) => {
    const region = core.slice(mark.at, marks[index + 1]?.at ?? core.length);
    entries.push(...entriesOf(region, mark.id));
    const drawn = new Set([...region.matchAll(/<([A-Za-z]+)(?:\.Page)?[\s/>]/g)].map((match) => match[1]));
    for (const name of drawn) {
      const file = files.get(name);
      if (!file || file === "settings-core.tsx") continue;
      try { entries.push(...entriesOf(fs.readFileSync(path.join(dir, file), "utf8"), mark.id)); } catch {}
    }
  });
  const seen = new Set();
  return entries.filter((entry) => { const key = `${entry.section}\0${entry.group}\0${entry.label}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
