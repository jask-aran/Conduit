import fs from "node:fs/promises";
import path from "node:path";
import { listRoutines, parseRoutine, readFolderFile, renderVars, splitFrontMatter, writeRoutine, writeFolderFile } from "../agent/routine-files.js";
import { block, promptVars, routineContext } from "../agent/routines.js";
import { render as renderMemory } from "../agent/memory.js";
import { renderWaitingInbox } from "../agent/inbox.js";

const safeId = /^[a-z][a-z0-9-]{0,63}$/;
const fail = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });
/** What Conduit fills in when the model runs: a name, and what goes there. */
const live = {
  "live-working-folder": ["Working folder", "The folder the thread works in: its project's, on whichever device holds it."],
  "live-web-tools": ["Web tools", "How to use web search and page fetching (templates/conduit-runtime/WEB.md)."],
  "live-codemode-tools": ["Codemode tools", "Every tool the thread has, as functions a script can call, and the connected accounts' actions."],
  "live-jbot-files": ["jbot's files", "jbot's soul, what it knows of the person, its memory and today's diary, as they stand each turn."],
  "live-inbox": ["Waiting inbox", "How often the person wants interrupting, and what is unhandled in jbot's inbox."],
  "live-routine-context": ["Routine's context", "The files the routine opts into (its context list): the diary, the person's file, memory."],
  "live-run-message": ["Run message", "When and why the run was woken, and what its tasks gathered (new mail, the calendar…)."],
  "live-subagent-task": ["Task", "The task the parent hands it, whole: goal, context, constraints, what to report."],
};
/** A skill as a block's name: "web-research" reads "Web research skill". */
const skillLabel = (name) => `${name.replace(/[-_]+/g, " ").replace(/^./, (letter) => letter.toUpperCase())} skill`;
const skillName = (text, folder) => /^name:\s*(.+)$/m.exec(text)?.[1]?.trim().replace(/^["']|["']$/g, "") || path.basename(folder);
const skillBody = (text) => text.replace(/^---\n[\s\S]*?\n---\n/, "").trim();

export class ContextStore {
  constructor({ root, templates, agent, webPath, seedDir, chatNamingPath, subagentPath }) {
    Object.assign(this, { root: path.resolve(root), templates, agent, webPath, seedDir, chatNamingPath, subagentPath });
  }

  async json(name) {
    try { return JSON.parse(await fs.readFile(path.join(this.root, name), "utf8")); }
    catch (error) { if (error.code === "ENOENT") return {}; throw error; }
  }
  async writeJson(name, value) {
    await fs.mkdir(this.root, { recursive: true });
    const file = path.join(this.root, name);
    const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
    await fs.rename(temp, file);
  }
  async catalog() {
    const blocks = new Map();
    const add = (id, label, source, extra = {}) => {
      if (blocks.has(id)) throw fail(`Duplicate block id: ${id}`, 500);
      blocks.set(id, { id, label, source, kind: "text", ...extra });
    };
    const agent = this.agent();
    for (const template of this.templates) add(template.id, template.id === "agent" ? agent?.settings().name || "jbot" : template.label, "shipped", { file: template.systemPrompt });
    const base = this.templates.find((item) => item.basePrompt)?.basePrompt;
    if (base) add("base", "Shared base", "shipped", { file: base });
    for (const folder of new Set(this.templates.flatMap((item) => item.skills || []))) {
      const id = `skill-${path.basename(folder)}`;
      if (!blocks.has(id)) add(id, skillLabel(skillName(await fs.readFile(path.join(folder, "SKILL.md"), "utf8"), folder)), "shipped", { file: path.join(folder, "SKILL.md"), skill: folder });
    }
    add("chat-naming", "Chat naming", "shipped", { file: this.chatNamingPath });
    add("subagent-brief", "Subagent brief", "shipped", { file: this.subagentPath });
    if (agent?.folder) {
      add("run-rules", "Run rules", "jbot", { runRules: true, file: path.join(this.seedDir, "RUN.md") });
      for (const routine of await listRoutines(agent.folder)) {
        if (routine.error) continue;
        const seed = path.join(this.seedDir, "routines", `${routine.name}.md`);
        const seedText = await fs.readFile(seed, "utf8").catch((error) => { if (error.code === "ENOENT") return null; throw error; });
        add(`routine-${routine.name}`, `${routine.title} instructions`, "jbot", { routine, defaultBody: seedText === null ? null : parseRoutine(seedText, routine.name).body });
      }
    }
    for (const [id, label] of Object.entries(await this.json("blocks.json"))) {
      if (safeId.test(id) && !blocks.has(id) && typeof label === "string") add(id, label, "custom");
    }
    for (const [id, [label, description]] of Object.entries(live)) blocks.set(id, { id, label, description, source: "conduit", kind: "live" });
    return blocks;
  }
  async documents(catalog) {
    catalog ||= await this.catalog();
    const docs = [];
    const add = (id, kind, roleId, label, blocks, sections = [], first = []) => docs.push({ id, label, role: { kind, id: roleId, label }, blocks, live: sections, first });
    const templateBlocks = (t) => [t.id, ...(t.basePrompt ? ["base"] : []), ...(t.skills || []).map((folder) => `skill-${path.basename(folder)}`)];
    const templateLive = (t, isAgent = false) => ["live-working-folder", ...((t.extensions || []).some((x) => x.includes("pi-web-access")) ? ["live-web-tools"] : []), ...((t.extensions || []).some((x) => /codemode-only\.js$/.test(x)) || t.connectors || isAgent ? ["live-codemode-tools"] : []), ...(isAgent ? ["live-jbot-files", "live-inbox"] : [])];
    for (const t of this.templates) {
      if (t.id === "agent") add("agent", "agent", "agent", catalog.get("agent").label, templateBlocks(t), templateLive(t, true));
      else if (!t.internal) add(`profile:${t.id}`, "profile", t.id, t.label, templateBlocks(t), templateLive(t));
    }
    const agentTemplate = this.templates.find((t) => t.id === "agent");
    if (agentTemplate && catalog.has("run-rules")) {
      const sections = templateLive(agentTemplate, true).filter((x) => x !== "live-jbot-files" && x !== "live-inbox");
      add("run:task", "run", "task", "Task run", ["run-rules"], sections, ["live-run-message"]);
      for (const item of catalog.values()) if (item.routine && item.routine.gate !== "never") add(`run:${item.routine.name}`, "run", item.routine.name, item.routine.title, ["run-rules", item.id], [...(item.routine.context.length ? ["live-routine-context"] : []), ...sections], ["live-run-message"]);
    }
    add("subagent", "subagent", "default", "Subagent", ["subagent-brief", "base"], ["live-working-folder", "live-web-tools"], ["live-subagent-task"]);
    add("service:chat-naming", "service", "chat-naming", "Chat naming", ["chat-naming"]);
    const saved = await this.json("documents.json");
    return docs.map((doc) => ({ ...doc, blocks: saved[doc.id]?.blocks || doc.blocks, modified: Boolean(saved[doc.id]) }));
  }
  async content(item) {
    if (item.routine) return item.routine.body;
    if (item.runRules) return (await readFolderFile(this.agent().folder, "RUN.md")) ?? "";
    const override = path.join(this.root, `${item.id}.md`);
    return fs.readFile(override, "utf8").catch((error) => { if (error.code === "ENOENT" && item.file) return fs.readFile(item.file, "utf8"); throw error; });
  }
  async defaultContent(item) {
    if (item.routine) return item.defaultBody;
    return item.file ? fs.readFile(item.file, "utf8") : null;
  }
  async previewLive(id) {
    if (id === "live-web-tools") return fs.readFile(this.webPath, "utf8");
    if (id === "live-jbot-files" && this.agent()?.folder) return renderMemory(this.agent());
    if (id === "live-inbox" && this.agent()?.enabled()) return renderWaitingInbox(this.agent());
    return `[${live[id][1]}]`;
  }
  async summary(item, docs) {
    const usedBy = docs.filter((doc) => [...doc.blocks, ...doc.live, ...doc.first].includes(item.id)).map((doc) => doc.id);
    if (item.kind === "live") return { id: item.id, label: item.label, kind: item.kind, source: item.source, description: item.description, modified: false, editable: false, resettable: false, deletable: false, chars: (await this.previewLive(item.id)).length, usedBy };
    const content = await this.content(item);
    const def = await this.defaultContent(item);
    return { id: item.id, label: item.label, kind: item.kind, source: item.source, modified: def !== null && content !== def, editable: true, resettable: def !== null, deletable: item.source === "custom" && !usedBy.length, chars: content.length, usedBy };
  }
  async list() {
    const catalog = await this.catalog(); const documents = await this.documents(catalog);
    return { blocks: await Promise.all([...catalog.values()].map((item) => this.summary(item, documents))), documents };
  }
  async get(id) {
    const catalog = await this.catalog(); const item = catalog.get(id);
    if (!item) throw fail("Unknown block", 404);
    const summary = await this.summary(item, await this.documents(catalog));
    if (item.kind === "live") return { ...summary, preview: await this.previewLive(id) };
    const def = await this.defaultContent(item);
    return { ...summary, content: await this.content(item), ...(def !== null ? { defaultContent: def } : {}) };
  }
  validate(content) {
    if (typeof content !== "string" || !content.trim()) throw fail("Block content is required");
    if (Buffer.byteLength(content, "utf8") > 128 * 1024) throw fail("Block exceeds 128 KiB", 413);
  }
  async save(id, { content, label } = {}) {
    const catalog = await this.catalog(); const item = catalog.get(id);
    if (!item) throw fail("Unknown block", 404);
    if (item.kind !== "text") throw fail("Block is read-only");
    if (label !== undefined && (item.source !== "custom" || typeof label !== "string" || !label.trim())) throw fail("Invalid block label");
    if (content !== undefined) {
      this.validate(content);
      if (item.routine) await writeRoutine(this.agent().folder, { ...item.routine, body: content });
      else if (item.runRules) await writeFolderFile(this.agent().folder, "RUN.md", content);
      else if (item.source !== "custom" && content === await this.defaultContent(item)) await fs.rm(path.join(this.root, `${id}.md`), { force: true });
      else {
        await fs.mkdir(this.root, { recursive: true });
        const target = path.join(this.root, `${id}.md`);
        const temp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
        await fs.writeFile(temp, content); await fs.rename(temp, target);
      }
    }
    if (label !== undefined) { const labels = await this.json("blocks.json"); labels[id] = label.trim(); await this.writeJson("blocks.json", labels); }
    return this.get(id);
  }
  async create({ label, content } = {}) {
    if (typeof label !== "string" || !label.trim()) throw fail("Block label is required");
    this.validate(content);
    const catalog = await this.catalog();
    let stem = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 52);
    if (!/^[a-z]/.test(stem)) stem = `block-${stem}`;
    let id = stem; for (let n = 2; catalog.has(id) || await fs.stat(path.join(this.root, `${id}.md`)).then(() => true, (e) => { if (e.code === "ENOENT") return false; throw e; }); n++) id = `${stem}-${n}`;
    await fs.mkdir(this.root, { recursive: true }); await fs.writeFile(path.join(this.root, `${id}.md`), content, { flag: "wx" });
    const labels = await this.json("blocks.json"); labels[id] = label.trim(); await this.writeJson("blocks.json", labels);
    return this.get(id);
  }
  async remove(id) {
    const item = await this.get(id);
    if (item.source !== "custom") throw fail("Only custom blocks can be deleted");
    if (item.usedBy.length) throw fail("Block is in use", 409, { usedBy: item.usedBy });
    const labels = await this.json("blocks.json"); delete labels[id]; await this.writeJson("blocks.json", labels);
    await fs.rm(path.join(this.root, `${id}.md`), { force: true });
  }
  async reset(id) {
    const catalog = await this.catalog(); const item = catalog.get(id);
    if (!item) throw fail("Unknown block", 404);
    const def = await this.defaultContent(item);
    if (def === null) throw fail("Block cannot be reset");
    if (item.routine || item.runRules) return this.save(id, { content: def });
    await fs.rm(path.join(this.root, `${id}.md`), { force: true }); return this.get(id);
  }
  async document(id) {
    const doc = (await this.documents()).find((item) => item.id === id);
    if (!doc) throw fail("Unknown document", 404);
    return doc;
  }
  async saveDocument(id, blocks) {
    await this.document(id); const catalog = await this.catalog();
    if (!Array.isArray(blocks) || !blocks.length || blocks.some((key) => typeof key !== "string" || catalog.get(key)?.kind !== "text")) throw fail("Document needs at least one text block");
    const saved = await this.json("documents.json"); saved[id] = { blocks }; await this.writeJson("documents.json", saved); return this.document(id);
  }
  async resetDocument(id) {
    await this.document(id); const saved = await this.json("documents.json"); delete saved[id]; await this.writeJson("documents.json", saved); return this.document(id);
  }
  async textSections(id, { vars } = {}) {
    const catalog = await this.catalog(); const doc = (await this.documents(catalog)).find((item) => item.id === id);
    if (!doc) throw fail("Unknown document", 404);
    const sections = []; let previousSkill = false;
    for (const key of doc.blocks) {
      // A block a saved document names but that has since gone (a routine deleted, a block removed) is left out, not
      // fatal: a role must still start.
      const item = catalog.get(key); if (!item || item.kind !== "text") continue;
      let text = await this.content(item);
      if (vars && (id === "agent" || id.startsWith("run:"))) text = renderVars(text, vars);
      if (item.routine) text = text.trim() ? block("routine", { name: item.routine.name, title: item.routine.title }, text) : "";
      else if (item.skill) text = `${previousSkill ? "" : "# Skills\n\n"}## Skill: ${skillName(text, item.skill)}\n\n${skillBody(text)}`;
      else if (id !== "service:chat-naming") text = text.trim();
      previousSkill = Boolean(item.skill);
      if (text) sections.push({ blockId: key, label: item.label, kind: "text", part: "system", text });
    }
    return { doc, sections };
  }
  async assemble(id, options = {}) { return (await this.textSections(id, options)).sections.map((item) => item.text).join("\n\n"); }
  async preview(id) {
    const agent = this.agent();
    const vars = agent && (id === "agent" || id.startsWith("run:")) ? await promptVars(agent) : undefined;
    const { doc, sections } = await this.textSections(id, { vars });
    for (const [part, ids] of [["system", doc.live], ["first", doc.first]]) for (const blockId of ids) {
      const routine = blockId === "live-routine-context" ? (await this.catalog()).get(`routine-${doc.role.id}`)?.routine : null;
      const text = routine && agent?.folder ? await routineContext(agent, routine) : await this.previewLive(blockId);
      sections.push({ blockId, label: live[blockId][0], kind: "live", part, text });
    }
    return { sections, chars: sections.reduce((sum, section) => sum + section.text.length, 0) };
  }
}
