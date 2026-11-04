import fs from "node:fs/promises";
import path from "node:path";
import { acceptSeedTemplate, seedTemplateUpdate, listRoutines, parseRoutine, readFolderFile, renderVars, splitFrontMatter, writeRoutine, writeFolderFile } from "../agent/routine-files.js";
import { block, promptVars, routineContext } from "../agent/routines.js";
import { render as renderMemory } from "../agent/memory.js";
import { renderWaitingInbox } from "../agent/inbox.js";
import { readPolicy, renderRules } from "../agent/approval-policy.js";

const safeId = /^[a-z][a-z0-9-]{0,63}$/;
const fail = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });
/** The index's opening: skills are listed, not pasted; the `skill` tool loads one (server/skill-tool.js). */
export const SKILLS_INTRO = "# Skills\n\nSkills are the instructions for kinds of work: each line below says when one applies. When one fits "
  + "what you are about to do, call `skill` with its name first and follow what it says. It is one quick call, and it beats "
  + "working from memory. A skill may name files of its own; `skill` reads those too.";

/*
 * What Conduit fills in when the model runs: blocks too, but templates -- the tags the model reads them in and the
 * slots ({{…}}) Conduit fills each turn. `tag` is the section's own tag (pi-durable wraps a section in it); the
 * template is written out whole so the page shows exactly the shape the model gets.
 */
const live = {
  "live-skills": { label: "Skills", description: "The skills this role can load: one line each, built from Settings › Skills and the role's skills. `skill` loads one.",
    template: `${SKILLS_INTRO}\n\n- **{{name}}**: {{description}}` },
  "live-connector-instructions": { label: "Connector instructions", description: "What each connected tool's own server says about using it, as it sends it when Conduit connects.",
    template: '<connector name="{{connector name}}">\n{{server instructions}}\n</connector>' },
  "live-working-folder": { label: "Working folder", tag: "cwd", description: "The folder the thread works in: its project's, on whichever device holds it.",
    template: "<cwd>\n{{working folder}}\n</cwd>" },
  "live-codemode-tools": { label: "Codemode tools", tag: "codemode", description: "Every tool the thread has, as functions a script can call; connected accounts' actions under their namespace.",
    template: "<codemode>\nTools scripts can call (`await tools.<name>(args)`):\n\n{{each tool: its name, what it does, its input}}\n\n## {{namespace}}\n{{what the namespace is}}\n\n{{each of its tools}}\n</codemode>" },
  "live-jbot-files": { label: "jbot's files", description: "jbot's soul, what it knows of the person, its memory and today's diary, as they stand each turn (16k characters at most: provenance lines go first). The section has no wrapper of its own.",
    template: "<soul>\n{{SOUL.md}}\n</soul>\n\n<user>\n{{USER.md, without its fields}}\n</user>\n\n<memory>\n{{MEMORY.md}}\n</memory>\n\n<diary day=\"{{today}}\">\n{{today's diary}}\n</diary>" },
  "live-inbox": { label: "Waiting inbox", tag: "agent-inbox", description: "How often the person wants interrupting, and what is unhandled in jbot's inbox. Home thread only.",
    template: "<agent-inbox>\nHow often the person wants to be interrupted: {{dial}} ({{what the dial means}}).\nUnhandled in your inbox ({{count}}). Tell the person what matters when it fits, then mark it with conduit_inbox handle:\n{{each unhandled entry, twelve at most}}\n</agent-inbox>" },
  "live-approval-rules": { label: "Your approval rules", tag: "approval-rules", description: "What you allow, what is always yours and what it must never do (Settings › jbot › Approvals). Read by the approval model with each held action; jbot reads them too, so it knows what will be asked.",
    template: "<approval-rules>\nIt may:\n{{may rules}}\n\nAlways yours:\n{{always rules}}\n\nNever:\n{{limits}}\n\nYour direct instructions: {{whether they need an approval}}\n\nConnected tools: {{whether they decide what is held}}\n</approval-rules>" },
  "live-routine-context": { label: "Routine's context", description: "The files the routine opts into (its context: list), each in its own tag.",
    template: "<diary day=\"{{today}}\">\n{{today's diary}}\n</diary>\n\n<{{user | memory | soul}}>\n{{the file, as it stands}}\n</{{user | memory | soul}}>" },
  "live-subagent-task": { label: "Task", description: "The task the parent hands it, whole: goal, context, constraints, what to report.",
    template: "{{the task, as the parent wrote it}}" },
};
/** The {{variables}} a jbot or run block can use (routines.js promptVars), with what each is. */
const VARS = [
  ["person.name", "The person's name (USER.md's name field)"], ["person.home", "Where they live (USER.md's home field)"],
  ["assistant.name", "jbot's name (Settings › jbot)"], ["timezone", "Their time zone"], ["now", "The current date and time; never filled in a system prompt"],
];
const NOTICE_SPECS = {
  "wake-run": [["now", "The current date and time"], ["reason", "The person asked for this run; A check-back you set; An event woke this run; A webhook woke this run; A feed's check; or A <kind> run"], ["task", "The run's task"]],
  "wake-event": [["task", "The watch's task"], ["event", "What happened"]],
  "wake-webhook": [["task", "The webhook's task"]],
  "wake-routine": [["now", "The current date and time"], ["routine.title", "The routine's title"], ["routine.name", "The routine's name"]],
  "report-run": [["report", "The run's report"], ["title", "The run's title"]],
  "report-brief": [["report", "The run's report"], ["title", "The run's title"]],
  "report-subagent": [["report", "The subagent's report"]],
  "approval-allowed": [["ask.title", "The approval's title"], ["ask.id", "The approval's id"]],
  "approval-denied": [["ask.title", "The approval's title"], ["ask.id", "The approval's id"]],
  "steer": [["assistant.name", "The assistant's name"], ["message", "The message"]],
  "stop": [], "update": [["changes", "The fixed slots that changed"]], "time": [["now", "The current date and time"]],
};
/** Each notice's name and what it is, as Settings says them. */
const NOTICE_ABOUT = {
  "wake-run": ["Run wake", "A run's first message when a check-back, a feed, Run now or a task jbot started wakes it."],
  "wake-event": ["Event wake", "What an event run is told happened (a device online, a chat finished), after its task."],
  "wake-webhook": ["Webhook wake", "A webhook run's warning that what follows is outside data, never instructions."],
  "wake-routine": ["Routine wake", "A routine's run's first message: the time and the routine, then what each task gathered."],
  "report-run": ["Run report", "A run's answer as it reaches jbot's home thread, then how jbot should weigh it."],
  "report-brief": ["Brief report", "The morning brief's answer as it reaches jbot, then: write the person the day's brief."],
  "report-subagent": ["Subagent report", "A background subagent's answer as it reaches the chat that started it."],
  "approval-allowed": ["Approval allowed", "The person allowed something the agent asked to do: it may now run exactly that, once."],
  "approval-denied": ["Approval denied", "The person declined something the agent asked to do."],
  "steer": ["Steer", "jbot's message into one of the person's chats (after they approve it)."],
  "stop": ["Stop note", "Before the next message after the person stopped a reply: the stop, not an error, cancelled it."],
  "update": ["Update note", "Before the next message when a fixed slot changed since the thread began (a name, the time zone)."],
  "time": ["Time note", "Before the person's message in a jbot thread not told the time in 30 minutes, or on a new day."],
};
const NOTICE_APPENDIX = { "wake-routine": "Conduit appends the routine's task blocks.", "wake-webhook": "Conduit appends the fenced webhook body." };
/** A skill as a block's name: "web-research" reads "Web research skill". */
const skillLabel = (name) => `${name.replace(/[-_]+/g, " ").replace(/^./, (letter) => letter.toUpperCase())} skill`;
const skillName = (text, folder) => /^name:\s*(.+)$/m.exec(text)?.[1]?.trim().replace(/^["']|["']$/g, "") || path.basename(folder);
const skillBody = (text) => text.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
const skillDescription = (text) => /^description:\s*(.+)$/m.exec(text)?.[1]?.trim().replace(/^["']|["']$/g, "") || "";
/** Whether a skill is offered to subagents and runs too: unless its front matter says `subagents: false`. */
const forSubagents = (text) => { try { return splitFrontMatter(text).data?.subagents !== false; } catch { return true; } };

export class ContextStore {
  constructor({ root, templates, agent, webPath, seedDir, chatNamingPath, subagentPath, skills = null }) {
    // skills: the hub's SkillStore (Settings › Skills): installed skills' blocks, and which skills are off.
    Object.assign(this, { root: path.resolve(root), templates, agent, webPath, seedDir, chatNamingPath, subagentPath, skills });
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
      const text = await fs.readFile(path.join(folder, "SKILL.md"), "utf8");
      if (!blocks.has(id)) add(id, skillLabel(skillName(text, folder)), "shipped", { file: path.join(folder, "SKILL.md"), skill: folder, subagents: forSubagents(text) });
    }
    // Skills installed on the hub (Settings › Skills), after the shipped ones; a shipped id keeps its own.
    for (const { id: skillId, folder } of this.skills?.installedFolders() || []) {
      const id = `skill-${skillId}`;
      const text = await fs.readFile(path.join(folder, "SKILL.md"), "utf8").catch(() => null);
      if (text !== null && !blocks.has(id)) add(id, skillLabel(skillName(text, folder)), "installed", { file: path.join(folder, "SKILL.md"), skill: folder, installed: true, subagents: forSubagents(text) });
    }
    add("approval-judge", "Approval model", "shipped", { file: new URL("../../../templates/approval/JUDGE.md", import.meta.url) });
    add("chat-naming", "Chat naming", "shipped", { file: this.chatNamingPath });
    add("web-tools", "Web tools", "shipped", { file: this.webPath, description: "Comes with the web tools: placed by Conduit after the document's own blocks." });
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
    for (const [name, slots] of Object.entries(NOTICE_SPECS)) add(`notice-${name}`, NOTICE_ABOUT[name]?.[0] ?? name.replace(/-/g, " "), "shipped", { kind: "notice", description: NOTICE_ABOUT[name]?.[1], file: new URL(`../../../templates/notices/${name}.md`, import.meta.url), slots: slots.map(([name, description]) => ({ name, description })), ...(NOTICE_APPENDIX[name] ? { appendix: NOTICE_APPENDIX[name] } : {}) });
    for (const [id, label] of Object.entries(await this.json("blocks.json"))) {
      if (safeId.test(id) && !blocks.has(id) && typeof label === "string") add(id, label, "custom");
    }
    for (const [id, item] of Object.entries(live)) blocks.set(id, { id, ...item, source: "conduit", kind: "live" });
    return blocks;
  }
  async documents(catalog) {
    catalog ||= await this.catalog();
    const docs = [];
    const isSkill = (id) => Boolean(catalog.get(id)?.skill) || id.startsWith("skill-");
    const add = (id, kind, roleId, label, blocks, sections = [], first = [], notices = []) => docs.push({
      id, label, role: { kind, id: roleId, label }, blocks: blocks.filter((key) => !isSkill(key)),
      skills: blocks.filter(isSkill), live: [...(kind !== "service" ? ["live-skills"] : []), ...sections], first, notices,
    });
    // A profile's default: its own skills, then every skill installed on the hub (a saved document keeps its list).
    const installed = [...catalog.values()].filter((item) => item.installed).map((item) => item.id);
    const templateBlocks = (t) => [...new Set([t.id, ...(t.basePrompt ? ["base"] : []), ...(t.skills || []).map((folder) => `skill-${path.basename(folder)}`), ...installed])];
    const templateLive = (t, isAgent = false) => ["live-working-folder", ...((t.extensions || []).some((x) => x.includes("pi-web-access")) ? ["web-tools"] : []), ...((t.extensions || []).some((x) => /codemode-only\.js$/.test(x)) || t.connectors || isAgent ? ["live-codemode-tools", "live-connector-instructions"] : []), ...(isAgent ? ["live-jbot-files", "live-inbox", "live-approval-rules"] : [])];
    for (const t of this.templates) {
      if (t.id === "agent") add("agent", "agent", "agent", catalog.get("agent").label, templateBlocks(t), templateLive(t, true), [], ["report-run", "report-brief", "report-subagent", "approval-allowed", "approval-denied", "update", "time", "stop"].map((x) => `notice-${x}`));
      else if (!t.internal) add(`profile:${t.id}`, "profile", t.id, t.label, templateBlocks(t), templateLive(t), [], [...(t.connectors ? ["notice-approval-allowed", "notice-approval-denied"] : []), "notice-report-subagent", "notice-stop"]);
    }
    // Subagents and runs do the legwork: they get every skill not marked `subagents: false`, after their own blocks.
    const legwork = [...new Set([...this.templates.flatMap((t) => (t.skills || []).map((folder) => `skill-${path.basename(folder)}`)), ...installed])]
      .filter((id) => catalog.get(id)?.subagents !== false);
    const agentTemplate = this.templates.find((t) => t.id === "agent");
    if (agentTemplate && catalog.has("run-rules")) {
      const sections = templateLive(agentTemplate, true).filter((x) => x !== "live-jbot-files" && x !== "live-inbox");
      add("run:task", "run", "task", "Task run", ["run-rules", ...legwork], sections, ["notice-wake-run"], ["notice-wake-event", "notice-wake-webhook"]);
      for (const item of catalog.values()) if (item.routine && item.routine.gate !== "never") add(`run:${item.routine.name}`, "run", item.routine.name, item.routine.title, ["run-rules", item.id, ...legwork], [...(item.routine.context.length ? ["live-routine-context"] : []), ...sections], ["notice-wake-routine"]);
    }
    add("subagent", "subagent", "default", "Subagent", ["subagent-brief", "base", ...legwork], ["live-working-folder", "web-tools"], ["live-subagent-task"]);
    add("service:approval", "service", "approval", "Approval model", ["approval-judge"], ["live-approval-rules"]);
    add("service:chat-naming", "service", "chat-naming", "Chat naming", ["chat-naming"]);
    const saved = await this.json("documents.json");
    let migrated = false;
    for (const stored of Object.values(saved)) {
      if (!Array.isArray(stored.blocks) || !stored.blocks.some(isSkill)) continue;
      stored.skills ??= stored.blocks.filter(isSkill);
      stored.blocks = stored.blocks.filter((key) => !isSkill(key));
      migrated = true;
    }
    if (migrated) await this.writeJson("documents.json", saved);
    return docs.map((doc) => {
      const stored = saved[doc.id];
      const blocks = stored?.blocks || doc.blocks;
      return { ...doc, blocks: blocks.filter((key) => !isSkill(key)),
        skills: stored?.skills ?? (stored?.blocks ? blocks.filter(isSkill) : doc.skills),
        subagents: stored?.subagents ?? null, modified: Boolean(stored) };
    });
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
  /** A live block as it stands now, in its section's tag as the model gets it; its template where it changes each thread. */
  async previewLive(id) {
    const wrap = (text) => live[id].tag ? `<${live[id].tag}>\n${text}\n</${live[id].tag}>` : text;
    if (id === "live-skills") return this.skillIndex([...(await this.catalog()).values()].filter((item) => item.skill).map((item) => item.id));
    if (id === "live-connector-instructions") return this.connectorInstructions();
    if (id === "live-jbot-files" && this.agent()?.folder) return wrap(await renderMemory(this.agent()));
    if (id === "live-inbox" && this.agent()?.enabled()) return wrap(await renderWaitingInbox(this.agent()));
    if (id === "live-approval-rules" && this.agent()?.enabled()) return wrap(renderRules((await readPolicy(this.agent())).policy, this.agent().settings()));
    return live[id].template;
  }
  async summary(item, docs, loaded = null) {
    const usedBy = docs.filter((doc) => [...doc.blocks, ...doc.skills, ...doc.live, ...doc.first, ...doc.notices].includes(item.id)).map((doc) => doc.id);
    if (item.kind === "live") {
      const preview = loaded && Object.hasOwn(loaded, "preview") ? loaded.preview : await this.previewLive(item.id);
      return { id: item.id, label: item.label, kind: item.kind, source: item.source, description: item.description, tag: item.tag, template: item.template, modified: false, editable: false, resettable: false, deletable: false, chars: preview.length, usedBy };
    }
    const [content, def] = loaded && Object.hasOwn(loaded, "content")
      ? [loaded.content, loaded.defaultContent]
      : await Promise.all([this.content(item), this.defaultContent(item)]);
    const relative = item.routine ? `routines/${item.routine.name}.md` : item.runRules ? "RUN.md" : null;
    const templateUpdate = relative && def !== null && await seedTemplateUpdate(this.agent().folder, relative,
      item.routine ? await fs.readFile(path.join(this.seedDir, relative), "utf8") : def);
    return { id: item.id, label: item.label, kind: item.kind, source: item.source, ...(item.skill ? { skill: true } : {}), ...(templateUpdate ? { templateUpdate: true } : {}), ...(item.description ? { description: item.description } : {}), ...(item.kind === "notice" ? { slots: item.slots, ...(item.appendix ? { appendix: item.appendix } : {}) } : {}), modified: def !== null && content !== def, editable: true, resettable: def !== null, deletable: item.source === "custom" && !usedBy.length, chars: content.length, usedBy };
  }
  async list() {
    const agent = this.agent();
    const catalogPromise = this.catalog();
    const valuesPromise = agent ? promptVars(agent).catch(() => null) : null;
    const catalog = await catalogPromise;
    const [documents, values] = await Promise.all([this.documents(catalog), valuesPromise]);
    const value = (name) => name.split(".").reduce((at, key) => at?.[key], values);
    return { blocks: await Promise.all([...catalog.values()].map((item) => this.summary(item, documents))), documents,
      vars: VARS.map(([name, description]) => ({ name, description, scope: name === "now" ? "current" : "fixed", ...(values ? { value: String(value(name) ?? "") } : {}) })) };
  }
  async get(id) {
    const catalog = await this.catalog(); const item = catalog.get(id);
    if (!item) throw fail("Unknown block", 404);
    const documentsPromise = this.documents(catalog);
    if (item.kind === "live") {
      const [documents, preview] = await Promise.all([documentsPromise, this.previewLive(id)]);
      return { ...await this.summary(item, documents, { preview }), preview };
    }
    const [documents, content, defaultContent] = await Promise.all([documentsPromise, this.content(item), this.defaultContent(item)]);
    const summary = await this.summary(item, documents, { content, defaultContent });
    return { ...summary, content, ...(defaultContent !== null ? { defaultContent } : {}), ...(summary.templateUpdate ? { templateText: defaultContent } : {}) };
  }
  validate(content) {
    if (typeof content !== "string" || !content.trim()) throw fail("Block content is required");
    if (Buffer.byteLength(content, "utf8") > 128 * 1024) throw fail("Block exceeds 128 KiB", 413);
  }
  async save(id, { content, label } = {}) {
    const catalog = await this.catalog(); const item = catalog.get(id);
    if (!item) throw fail("Unknown block", 404);
    if (item.kind !== "text" && item.kind !== "notice") throw fail("Block is read-only");
    if (label !== undefined && (item.source !== "custom" || typeof label !== "string" || !label.trim())) throw fail("Invalid block label");
    if (content !== undefined) {
      if (!(item.routine?.gate === "never" && content === "")) this.validate(content);
      if (item.routine || item.runRules) {
        const folder = this.agent().folder;
        const relative = item.routine ? `routines/${item.routine.name}.md` : "RUN.md";
        if (item.routine) await writeRoutine(folder, { ...item.routine, body: content });
        else await writeFolderFile(folder, relative, content);
        const template = await fs.readFile(path.join(this.seedDir, relative), "utf8").catch((error) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
        if (template !== null) await acceptSeedTemplate(folder, relative, template);
      } else if (item.source !== "custom" && content === await this.defaultContent(item)) await fs.rm(path.join(this.root, `${id}.md`), { force: true });
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
  /** The skills `skill` can load: every enabled skill, shipped or installed, by name, with its folder and SKILL.md text. */
  async skillsAvailable() {
    const out = [];
    for (const item of (await this.catalog()).values()) {
      if (!item.skill || (this.skills && !this.skills.enabled(path.basename(item.skill)))) continue;
      const text = await this.content(item).catch(() => null);
      if (text === null) continue;
      let data = {};
      try { data = splitFrontMatter(text).data || {}; } catch { /* a skill with broken front matter still loads by name */ }
      out.push({ name: skillName(text, item.skill), description: skillDescription(text), folder: item.skill, text,
        load: data.load === "auto" ? "auto" : "nudge", nudge: Array.isArray(data.nudge) ? data.nudge : [], subagents: data.subagents !== false });
    }
    return out;
  }

  /** A text block's current text, for a section Conduit places itself (the web tools). */
  async text(id) {
    const item = (await this.catalog()).get(id);
    if (!item || item.kind !== "text") throw fail("Unknown text block", 404);
    return this.content(item);
  }
  async notice(name, vars = {}) {
    const item = (await this.catalog()).get(`notice-${name}`);
    if (!item || item.kind !== "notice") throw fail("Unknown notice", 404);
    return renderVars(await this.content(item), vars);
  }
  async document(id) {
    const doc = (await this.documents()).find((item) => item.id === id);
    if (!doc) throw fail("Unknown document", 404);
    return doc;
  }
  async saveDocument(id, input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw fail("Invalid document settings");
    const { blocks, skills, subagents } = input;
    await this.document(id); const catalog = await this.catalog();
    if (blocks !== undefined && (!Array.isArray(blocks) || !blocks.length || blocks.some((key) => typeof key !== "string" || (catalog.get(key)?.kind !== "text" || catalog.get(key)?.skill)))) throw fail("Document needs at least one text block");
    if (skills !== undefined && (!Array.isArray(skills) || skills.some((key) => typeof key !== "string" || !catalog.get(key)?.skill))) throw fail("Invalid document skills");
    if (subagents !== undefined && subagents !== null && (typeof subagents !== "object" || Array.isArray(subagents)
      || Object.keys(subagents).length !== 2 || typeof subagents.model !== "string" || !/^[^/\s]+\/\S+$/.test(subagents.model)
      || !["off", "minimal", "low", "medium", "high", "max", "xhigh"].includes(subagents.thinkingLevel))) throw fail("Invalid subagents settings");
    if (blocks === undefined && skills === undefined && subagents === undefined) throw fail("Document needs blocks, skills or subagents");
    const saved = await this.json("documents.json");
    const current = await this.document(id);
    saved[id] = { ...saved[id], blocks: blocks ?? current.blocks, skills: skills ?? current.skills, ...(subagents !== undefined ? { subagents } : {}) }; await this.writeJson("documents.json", saved); return this.document(id);
  }
  async resetDocument(id) {
    await this.document(id); const saved = await this.json("documents.json");
    if (saved[id]) { delete saved[id].blocks; delete saved[id].skills; if (!Object.keys(saved[id]).length) delete saved[id]; }
    await this.writeJson("documents.json", saved); return this.document(id);
  }
  async textSections(id, { vars, catalog: loadedCatalog } = {}) {
    const catalog = loadedCatalog || await this.catalog(); const doc = (await this.documents(catalog)).find((item) => item.id === id);
    if (!doc) throw fail("Unknown document", 404);
    const sections = [];
    // A block a saved document names but that has since gone (a routine deleted, a block removed) is left out, not
    // fatal: a role must still start. Every block's file read at once; the sections are still laid out in order.
    // A skill turned off in Settings › Skills is left out wherever it is placed.
    const blocks = doc.blocks.map((key) => ({ key, item: catalog.get(key) })).filter(({ item }) => item && item.kind === "text");
    const contents = await Promise.all(blocks.map(({ item }) => this.content(item)));
    for (const [index, { key, item }] of blocks.entries()) {
      let text = contents[index];
      if (vars && (id === "agent" || id.startsWith("run:"))) { const { now: _now, ...fixed } = vars; text = renderVars(text, fixed); }
      if (item.routine) text = text.trim() ? block("routine", { name: item.routine.name, title: item.routine.title }, text) : "";
      else if (id !== "service:chat-naming") text = text.trim();
      if (text) sections.push({ blockId: key, label: item.label, kind: "text", part: "system", text });
    }
    if (doc.live.includes("live-skills")) {
      const text = await this.skillIndex(doc.skills, { id, vars, catalog });
      if (text) sections.push({ blockId: "live-skills", label: "Skills", kind: "live", part: "system", text });
    }
    return { doc, sections };
  }
  /** One index, in the system instructions after the role's text blocks; preserve the old separators. */
  async skillIndex(ids, { id, vars, catalog } = {}) {
    catalog ||= await this.catalog();
    const entries = [];
    for (const key of ids) {
      const item = catalog.get(key);
      if (!item?.skill || (this.skills && !this.skills.enabled(path.basename(item.skill)))
        || (item.subagents === false && (id === "subagent" || id?.startsWith("run:")))) continue;
      let text = await this.content(item);
      if (vars && (id === "agent" || id?.startsWith("run:"))) { const { now: _now, ...fixed } = vars; text = renderVars(text, fixed); }
      entries.push(`- **${skillName(text, item.skill)}**: ${skillDescription(text) || "(no description)"}`);
    }
    return entries.length ? `${SKILLS_INTRO}\n\n${entries.join("\n\n")}` : "";
  }
  connectorInstructions() {
    const connectors = this.agent()?.connectors;
    return (connectors?.list() || []).flatMap(({ id, label, status }) => {
      const text = status === "on" && connectors.instructions(id);
      return text ? [block("connector", { name: label }, text)] : [];
    }).join("\n\n");
  }
  async assemble(id, options = {}) { return (await this.textSections(id, options)).sections.map((item) => item.text).join("\n\n"); }
  async approvalInstructions() { return this.assemble("service:approval"); }
  async preview(id) {
    const agent = this.agent();
    const [vars, catalog] = await Promise.all([
      agent && (id === "agent" || id.startsWith("run:")) ? promptVars(agent) : null,
      this.catalog(),
    ]);
    const { doc, sections } = await this.textSections(id, { vars, catalog });
    for (const [part, ids] of [["system", doc.live], ["first", doc.first], ["notice", doc.notices]]) for (const blockId of ids) {
      if (blockId === "live-skills") continue; // Already placed in the system instructions.
      const routine = blockId === "live-routine-context" ? catalog.get(`routine-${doc.role.id}`)?.routine : null;
      const item = catalog.get(blockId);
      if (item?.kind === "notice") { const sample = { ...(vars || {}), now: vars?.now || new Date().toLocaleString(), task: "The task", reason: "The person asked for this run", event: "An event", routine: { title: "Routine", name: "routine" }, report: "The report", title: "Run", ask: { title: "Approval", id: "a-1" }, assistant: { name: "jbot" }, message: "Message", changes: "the person is now Sam" }; sections.push({ blockId, label: item.label, kind: "notice", part, text: renderVars(await this.content(item), sample) }); continue; }
      if (item?.kind === "text") { sections.push({ blockId, label: item.label, kind: "text", part, placed: true, text: (await this.content(item)).trim() }); continue; }
      const text = routine && agent?.folder ? await routineContext(agent, routine) : await this.previewLive(blockId);
      sections.push({ blockId, label: live[blockId].label, kind: "live", part, text });
    }
    return { sections, chars: sections.reduce((sum, section) => sum + section.text.length, 0) };
  }
}
