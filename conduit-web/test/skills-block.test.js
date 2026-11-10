import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { CompactionEntry, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { listPiTemplates } from "../../scripts/pi-runtime.mjs";
import { ContextStore, SKILLS_INTRO } from "../src/context/context-store.js";
import { block } from "../src/agent/routines.js";
import { renderVars, seedRoutines } from "../src/agent/routine-files.js";
import { Connectors } from "../src/agent/connectors.js";
import { registerContextRoutes } from "../src/server/routes/context.js";
import { SkillTool, SkillUse, skillNudges } from "../src/server/skill-tool.js";

const templatesRoot = fileURLToPath(new URL("../../templates/", import.meta.url));
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-skills-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const templates = listPiTemplates(templatesRoot);
  const agent = { folder: root, settings: () => ({ name: "jbot" }), enabled: () => false };
  await seedRoutines(root, path.join(templatesRoot, "agent/seed/routines"));
  const store = new ContextStore({ root: path.join(root, "context"), templates, agent: () => agent,
    seedDir: path.join(templatesRoot, "agent/seed"), webPath: path.join(templatesRoot, "conduit-runtime/WEB.md"),
    chatNamingPath: path.join(templatesRoot, "chat-naming/SYSTEM.md"), subagentPath: path.join(templatesRoot, "subagent/BRIEF.md") });
  return { root, store, templates, agent };
}

// Snapshot the pre-change document ordering and assembler, independently of documents() and assemble().
async function legacyPrompts(store, templates, vars) {
  const catalog = await store.catalog();
  const installed = [...catalog.values()].filter((item) => item.installed).map((item) => item.id);
  const skillIds = (template) => (template.skills || []).map((folder) => `skill-${path.basename(folder)}`);
  const legwork = [...new Set([...templates.flatMap(skillIds), ...installed])].filter((id) => catalog.get(id)?.subagents !== false);
  const stacks = new Map();
  for (const template of templates) if (template.id === "agent" || !template.internal) {
    stacks.set(template.id === "agent" ? "agent" : `profile:${template.id}`,
      [...new Set([template.id, ...(template.basePrompt ? ["base"] : []), ...skillIds(template), ...installed])]);
  }
  stacks.set("run:task", ["run-rules", ...legwork]);
  for (const item of catalog.values()) if (item.routine && item.routine.gate !== "never") stacks.set(`run:${item.routine.name}`, ["run-rules", item.id, ...legwork]);
  stacks.set("subagent", ["subagent-brief", "base", ...legwork]);
  stacks.set("service:approval", ["approval-judge"]);
  stacks.set("service:chat-naming", ["chat-naming"]);
  const field = (text, name) => new RegExp(`^${name}:\\s*(.+)$`, "m").exec(text)?.[1]?.trim().replace(/^["']|["']$/g, "");
  const snapshots = new Map();
  for (const [id, ids] of stacks) {
    const texts = []; let previousSkill = false;
    for (const key of ids) {
      const item = catalog.get(key);
      if (!item || (item.skill && store.skills && !store.skills.enabled(path.basename(item.skill)))) continue;
      let text = await store.content(item);
      if (id === "agent" || id.startsWith("run:")) { const { now: _now, ...fixed } = vars; text = renderVars(text, fixed); }
      if (item.routine) text = text.trim() ? block("routine", { name: item.routine.name, title: item.routine.title }, text) : "";
      else if (item.skill) text = `${previousSkill ? "" : `${SKILLS_INTRO}\n\n`}- **${field(text, "name") || path.basename(item.skill)}**: ${field(text, "description") || "(no description)"}`;
      else if (id !== "service:chat-naming") text = text.trim();
      previousSkill = Boolean(item.skill);
      if (text) texts.push(text);
    }
    snapshots.set(id, texts.join("\n\n"));
  }
  return snapshots;
}

test("all shipped documents preserve the old prompt bytes and skill order", async (t) => {
  const { store, templates } = await fixture(t);
  const vars = { person: { name: "Sam", home: "Sydney" }, assistant: { name: "jbot" }, timezone: "Australia/Sydney", now: "never in system" };
  for (const disabled of [false, true]) {
    store.skills = { installedFolders: () => [{ id: "extra", folder: path.join(templatesRoot, "skills/managed-python") }], enabled: (name) => !disabled || name !== "web-research" };
    const before = await legacyPrompts(store, templates, vars);
    const docs = await store.documents();
    assert.ok(docs.some((doc) => doc.id === "run:heartbeat"));
    assert.deepEqual(docs.map((doc) => doc.id).sort(), [...before.keys()].sort());
    for (const doc of docs) {
      assert.equal(await store.assemble(doc.id, { vars }), before.get(doc.id), doc.id);
      assert.ok(doc.blocks.every((id) => !id.startsWith("skill-")));
      if (doc.role.kind !== "service") assert.equal(doc.live[0], "live-skills");
      if (doc.live.includes("live-codemode-tools")) assert.equal(doc.live[doc.live.indexOf("live-codemode-tools") + 1], "live-connector-instructions");
    }
  }
  const preview = await store.preview("profile:assistant");
  assert.equal(preview.sections.filter((section) => section.blockId === "live-skills").length, 1);
  assert.ok(!(await store.assemble("subagent")).includes("**routines**"));
  const available = await store.skillsAvailable();
  assert.equal(available.find((skill) => skill.name === "executor").load, "auto");
  assert.equal(available.find((skill) => skill.name === "managed-python").load, "nudge");
});

test("saved skills read back; PUT saves skills and usedBy follows membership", async (t) => {
  const { store } = await fixture(t);
  const skills = ["skill-executor", "skill-web-research"];
  await store.writeJson("documents.json", { "profile:assistant": { blocks: ["assistant", "base"], skills } });
  const doc = await store.document("profile:assistant");
  assert.deepEqual(doc.blocks, ["assistant", "base"]);
  assert.deepEqual(doc.skills, skills);
  assert.ok((await store.get("skill-executor")).usedBy.includes(doc.id));
  const routes = new Map();
  const app = Object.fromEntries(["get", "put", "post", "delete"].map((method) => [method, (url, handler) => routes.set(`${method} ${url}`, handler)]));
  registerContextRoutes(app, { contextStore: store });
  let saved;
  await routes.get("put /v0/context/documents/:id")({ params: { id: doc.id }, body: { skills: ["skill-web-research"] } },
    { json: (value) => { saved = value; } }, (error) => { throw error; });
  assert.deepEqual(saved.skills, ["skill-web-research"]);
  assert.deepEqual((await store.json("documents.json"))[doc.id].skills, saved.skills);
  assert.ok(!(await store.get("skill-executor")).usedBy.includes(doc.id));
  await assert.rejects(store.saveDocument(doc.id, { skills: ["base"] }), /Invalid document skills/);
  await store.saveDocument(doc.id, { skills: [] });
  assert.ok(!(await store.assemble(doc.id)).includes("# Skills"));
  await store.resetDocument(doc.id);
  assert.ok((await store.document(doc.id)).skills.includes("skill-executor"));
});

test("connector instructions render only for connected servers that sent text", async (t) => {
  const { store, agent } = await fixture(t);
  const connectors = new Connectors(agent);
  agent.connectors = connectors;
  const entry = connectors.entry("executor");
  assert.equal(connectors.instructions("executor"), null);
  assert.equal(await store.previewLive("live-connector-instructions"), "");
  entry.status = "on"; entry.instructions = "Use the server's own instructions.";
  assert.equal(await store.previewLive("live-connector-instructions"), '<connector name="Executor">\nUse the server\'s own instructions.\n</connector>');
  entry.instructions = null;
  assert.equal(await store.previewLive("live-connector-instructions"), "");
});

async function toolFixture(t, load = "auto") {
  const { root, store } = await fixture(t);
  const harness = await Harness.open(new MemoryStorage(), { models: createModels(), registry: createRegistry() }, context);
  t.after(() => harness.close(context));
  await fs.mkdir(path.join(root, "runtime"));
  const executor = (await store.skillsAvailable()).find((skill) => skill.name === "executor");
  const skill = { ...executor, load, nudge: ["work"] };
  const runtime = { dataRoot: root, harness, skillsAvailable: async () => [skill] };
  const conversation = await harness.createConversation({ ownership: { kind: "ownerless" } }, context);
  const api = { conversationId: conversation.id, commit: (change) => conversation.commit(change, context) };
  const outcome = { output: [{ type: "text", text: "Tool result" }], structuredOutput: { kept: true } };
  const tool = skillNudges(runtime, ["work"])[0].wrap({ name: "work", execute: async () => outcome });
  const call = () => tool.execute({}, api, context);
  const loadSkill = () => SkillTool(runtime).execute({ name: skill.name }, api, context);
  const append = (text) => conversation.commit((tx) => tx.appendEntry(conversation.id, {
    kind: "fixture", model: [{ role: "user", content: text, timestamp: Date.now() }],
  }), context);
  return { runtime, harness, conversation, api, outcome, call, loadSkill, append };
}

test("auto loads once, expires at 50,000 tokens, and reloads after a committed compaction", async (t) => {
  const f = await toolFixture(t);
  await f.append("Begin");
  const first = await f.call();
  assert.match(first.output[0].text, /^\[The executor skill, loaded for this call\]\n/);
  assert.equal(first.output[0].text, `[The executor skill, loaded for this call]\n${(await f.loadSkill()).output[0].text}`);
  assert.deepEqual(first.output.slice(1), f.outcome.output);
  assert.deepEqual(first.structuredOutput, f.outcome.structuredOutput);
  assert.deepEqual(await f.call(), f.outcome);
  await f.append("x".repeat(175_000));
  assert.match((await f.call()).output[0].text, /loaded for this call/);
  assert.deepEqual(await f.call(), f.outcome);
  const kept = await f.append("Keep this recent entry");
  await f.conversation.commit((tx) => tx.appendEntry(CompactionEntry, f.conversation.id, {
    head: kept.id, data: { reason: "manual" }, model: [{ role: "user", content: "Compacted summary", timestamp: Date.now() }],
  }), context);
  assert.equal((await f.conversation.context(context)).head.kind, "pi.compaction");
  assert.match((await f.call()).output[0].text, /loaded for this call/);
  assert.deepEqual(await f.call(), f.outcome);
  const loaded = (await f.harness.snapshot(SkillUse, f.conversation.id, context)).loaded.executor;
  assert.equal(loaded.head, (await f.conversation.context(context)).head.id);
  assert.equal(typeof loaded.tokens, "number");
});

test("a model skill call refreshes the window; other conversations load independently", async (t) => {
  const f = await toolFixture(t);
  await f.loadSkill();
  assert.deepEqual(await f.call(), f.outcome);
  await f.append("x".repeat(175_000));
  await f.loadSkill();
  assert.deepEqual(await f.call(), f.outcome);
  const other = await f.harness.createConversation({ ownership: { kind: "ownerless" } }, context);
  const tool = skillNudges(f.runtime, ["work"])[0].wrap({ name: "work", execute: async () => f.outcome });
  const output = await tool.execute({}, { conversationId: other.id, commit: (change) => other.commit(change, context) }, context);
  assert.match(output.output[0].text, /loaded for this call/);
});

test("nudge skills keep the exact note and do not inject a body", async (t) => {
  const f = await toolFixture(t, "nudge");
  assert.deepEqual((await f.call()).output, [...f.outcome.output, { type: "text", text: "[The executor skill covers this kind of work: load it with skill before going further.]" }]);
  assert.deepEqual(await f.call(), f.outcome);
  await f.loadSkill();
  assert.deepEqual(await f.call(), f.outcome);
});
