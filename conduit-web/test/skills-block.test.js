import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { listPiTemplates } from "../../scripts/pi-runtime.mjs";
import { ContextStore } from "../src/context/context-store.js";
import { seedRoutines } from "../src/agent/routine-files.js";
import { registerContextRoutes } from "../src/server/routes/context.js";

const templatesRoot = fileURLToPath(new URL("../../templates/", import.meta.url));
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-skills-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const templates = listPiTemplates(templatesRoot);
  const agent = { folder: root, settings: () => ({ name: "jbot" }), enabled: () => false };
  await seedRoutines(root, path.join(templatesRoot, "agent/seed/routines"));
  const store = new ContextStore({ root: path.join(root, "context"), templates, agent: () => agent,
    seedDir: path.join(templatesRoot, "agent/seed"), webPath: path.join(templatesRoot, "web-tools/WEB.md"),
    chatNamingPath: path.join(templatesRoot, "chat-naming/SYSTEM.md"), subagentPath: path.join(templatesRoot, "subagent/BRIEF.md") });
  return { root, store, templates, agent };
}

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
