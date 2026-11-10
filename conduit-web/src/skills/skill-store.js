/**
 * The hub's skills (Settings › Skills): the ones Conduit ships with its profiles (a template's `skills` folders) and the
 * ones installed here, each a folder with a SKILL.md under `root`. Any of them can be turned off. Installed skills come
 * from a registry -- skills.sh today, the directory `npx skills` searches and installs from -- by the same download the
 * CLI makes, written into this folder rather than an agent's; uploads and other registries come later.
 *
 * Every skill is a prompt block (context-store.js `skill-<id>`): a skill that is off is left out where a prompt is
 * assembled, and an installed one joins each profile's default document.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { writePrivateJson } from "../private-file.js";

const REGISTRY = "https://skills.sh";
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_FILES = 200;
const MAX_BYTES = 5 * 1024 * 1024;

/** A SKILL.md's front matter: its name and description. */
function skillFrontMatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text || "");
  const field = (name) => {
    const found = match && new RegExp(`^${name}:\\s*(.+)$`, "m").exec(match[1]);
    return found ? found[1].trim().replace(/^["']|["']$/g, "") : "";
  };
  return { name: field("name"), description: field("description") };
}

const idFor = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);

export class SkillStore {
  constructor({ root, templates = [], fetch: fetcher = globalThis.fetch } = {}) {
    this.root = root;
    this.templates = templates;
    // A registry the hub cannot reach is said as that, not as the network library's "fetch failed".
    this.fetch = (url, options) => fetcher(url, options).catch((error) => {
      throw Object.assign(new Error(`The hub could not reach ${new URL(url).host} (${error.cause?.code || error.name || "network error"})`), { status: 502 });
    });
    this.stateFile = path.join(root, "skills.json");
    this.state = { disabled: [], installed: {} };
  }

  async load() {
    try {
      const saved = JSON.parse(await fs.readFile(this.stateFile, "utf8"));
      this.state = {
        disabled: Array.isArray(saved.disabled) ? saved.disabled.filter((id) => typeof id === "string") : [],
        installed: saved.installed && typeof saved.installed === "object" ? saved.installed : {},
      };
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    return this;
  }

  async save() {
    await writePrivateJson(this.stateFile, this.state);
  }

  enabled(id) { return !this.state.disabled.includes(id); }

  /** Installed skills' folders, for the prompt catalog: `{ id, folder }`, whether on or off. */
  installedFolders() {
    return Object.keys(this.state.installed).filter((id) => SAFE_ID.test(id)).map((id) => ({ id, folder: path.join(this.root, id) }));
  }

  /** Every skill: shipped then installed, with what the page shows of each. */
  async list() {
    const shipped = new Map();
    for (const template of this.templates) for (const folder of template.skills || []) {
      const id = path.basename(folder);
      const entry = shipped.get(id) || { id, folder, profiles: [] };
      if (!template.internal) entry.profiles.push(template.id === "agent" ? "jbot" : template.label || template.id);
      shipped.set(id, entry);
    }
    const describe = async ({ id, folder }, extra) => {
      const text = await fs.readFile(path.join(folder, "SKILL.md"), "utf8").catch(() => null);
      const front = skillFrontMatter(text);
      return { id, name: front.name || id, description: front.description, chars: text?.length ?? 0, missing: text === null, enabled: this.enabled(id), ...extra };
    };
    return Promise.all([
      ...[...shipped.values()].map((item) => describe(item, { origin: "shipped", profiles: item.profiles })),
      ...this.installedFolders().map((item) => describe(item, { origin: "installed", source: this.state.installed[item.id].source, skillId: this.state.installed[item.id].skillId, installedAt: this.state.installed[item.id].installedAt, profiles: ["Every profile's default"] })),
    ]);
  }

  async setEnabled(id, enabled) {
    const known = (await this.list()).some((skill) => skill.id === id);
    if (!known) throw Object.assign(new Error("No such skill"), { status: 404 });
    this.state.disabled = enabled ? this.state.disabled.filter((item) => item !== id) : [...new Set([...this.state.disabled, id])];
    await this.save();
  }

  /** The registry's search (the one `npx skills find` makes). */
  async search(query, limit = 20) {
    const q = String(query || "").trim().slice(0, 100);
    if (q.length < 2) return [];
    const response = await this.fetch(`${REGISTRY}/api/search?${new URLSearchParams({ q, limit: String(Math.min(50, limit)) })}`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw Object.assign(new Error(`The registry answered ${response.status}`), { status: 502 });
    const found = await response.json();
    const installed = new Set(Object.values(this.state.installed).map((item) => `${item.source}/${item.skillId}`));
    return (found.skills || []).filter((item) => /^[\w.-]+\/[\w.-]+$/.test(item.source || "") && item.skillId)
      .map((item) => ({ source: item.source, skillId: item.skillId, name: item.name || item.skillId, installs: item.installs ?? null, installed: installed.has(`${item.source}/${item.skillId}`) }));
  }

  /** Download one skill (the files `npx skills add <source> --skill <id>` would write) into its own folder here. */
  async install(source, skillId) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(source || "") || !/^[\w.-]{1,100}$/.test(skillId || "")) throw Object.assign(new Error("Choose a skill from the registry"), { status: 400 });
    const [owner, repo] = source.split("/");
    const response = await this.fetch(`${REGISTRY}/api/download/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(skillId)}`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw Object.assign(new Error(`The registry has no download for ${source} ${skillId} (${response.status}); install it with npx skills for now`), { status: 502 });
    const { files } = await response.json();
    if (!Array.isArray(files) || !files.some((file) => file?.path === "SKILL.md")) throw Object.assign(new Error("The download has no SKILL.md"), { status: 502 });
    if (files.length > MAX_FILES) throw Object.assign(new Error("The skill has too many files"), { status: 413 });
    let bytes = 0;
    for (const file of files) {
      const relative = String(file?.path || "");
      if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some((part) => part === ".." || part === "") || typeof file.contents !== "string") {
        throw Object.assign(new Error(`The download has an unsafe path: ${relative}`), { status: 502 });
      }
      bytes += Buffer.byteLength(file.contents);
    }
    if (bytes > MAX_BYTES) throw Object.assign(new Error("The skill is larger than 5 MB"), { status: 413 });
    // Its id: the skill's own, unless that is taken by a shipped or another installed one.
    const taken = new Set((await this.list()).map((skill) => skill.id));
    const existing = Object.entries(this.state.installed).find(([, item]) => item.source === source && item.skillId === skillId)?.[0];
    const base = idFor(skillId) || "skill";
    let id = existing || base;
    for (let n = 2; !existing && taken.has(id); n += 1) {
      const suffix = `-${n}`;
      id = `${base.slice(0, Math.max(0, 64 - suffix.length))}${suffix}`;
      if (!SAFE_ID.test(id)) break;
    }
    if (!SAFE_ID.test(id)) throw Object.assign(new Error("The skill has no valid install id"), { status: 400 });
    const folder = path.join(this.root, id);
    const staging = path.join(this.root, `.${id}.${process.pid}.staging`);
    await fs.rm(staging, { recursive: true, force: true });
    for (const file of files) {
      const target = path.join(staging, file.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.contents);
    }
    await fs.rm(folder, { recursive: true, force: true });
    await fs.rename(staging, folder);
    this.state.installed[id] = { source, skillId, installedAt: new Date().toISOString() };
    await this.save();
    return (await this.list()).find((skill) => skill.id === id);
  }

  async remove(id) {
    if (!Object.hasOwn(this.state.installed, id) || !SAFE_ID.test(id)) throw Object.assign(new Error("Only an installed skill can be removed"), { status: 400 });
    await fs.rm(path.join(this.root, id), { recursive: true, force: true });
    delete this.state.installed[id];
    this.state.disabled = this.state.disabled.filter((item) => item !== id);
    await this.save();
  }
}
