import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildManagedToolEnvironment,
  listPiTemplates,
  templatePublicView,
} from "../../scripts/pi-runtime.mjs";

test("repository templates are discoverable launch presets", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../templates");
  const templates = listPiTemplates(root);
  assert.ok(templates.some((template) => template.id === "assistant"));
  assert.ok(templates.some((template) => template.id === "coding"));
  assert.ok(!templates.some((template) => template.id === "code-mode"));
  assert.ok(templates.some((template) => template.id === "runtime"));
  const workspace = templates.find((template) => template.id === "coding");
  const general = templates.find((template) => template.id === "assistant");
  const view = templatePublicView(workspace);
  assert.equal(view.label, "Coding");
  assert.equal(workspace.version, "9");
  assert.equal(view.defaultable, true);
  assert.deepEqual(workspace.tools, ["read", "bash", "edit", "write", "web_search", "fetch_content", "get_search_content", "source_check", "codemode"]);
  assert.deepEqual(workspace.extensions, [path.resolve(root, "../conduit-web/node_modules/pi-web-access"), path.resolve(root, "coding/extensions/codemode-only.js")]);
  assert.ok(view.skillCount >= 1);
  assert.deepEqual(workspace.skills, [path.resolve(root, "coding/skills/git-github"), path.resolve(root, "coding/skills/web-research"), path.resolve(root, "coding/skills/develop-loop")]);
  assert.equal(general.label, "Assistant");
  assert.equal(general.version, "10");
  assert.deepEqual(general.skills, [path.resolve(root, "coding/skills/web-research")]);
  assert.deepEqual(general.tools, ["read", "bash", "edit", "write", "web_search", "fetch_content", "get_search_content", "source_check"]);
  assert.deepEqual(general.extensions, [path.resolve(root, "../conduit-web/node_modules/pi-web-access")]);
  const systemPrompt = fs.readFileSync(general.systemPrompt, "utf8");
  assert.match(systemPrompt, /Bash is your code-mode runtime/);
  assert.match(systemPrompt, /use `python` from Bash/);
  // Web research guidance is the durable agent's, shared by every profile with web tools.
  const web = fs.readFileSync(path.resolve(root, "conduit-runtime/WEB.md"), "utf8");
  assert.match(web, /Use this sequence:/);
  assert.match(web, /fetch_content.*selected pages/s);
  assert.equal(view.extensionCount, 2);
  assert.equal(templatePublicView(templates.find((template) => template.id === "runtime")).defaultable, false);
});

test("listPiTemplates rejects duplicate template ids", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "conduit-dup-templates-"));
  for (const dir of ["one", "two"]) {
    const folder = path.join(root, dir);
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, "SYSTEM.md"), "# x\n");
    fs.writeFileSync(path.join(folder, "template.json"), JSON.stringify({
      id: "shared",
      version: "1",
      tools: ["read"],
      models: [],
      extensions: [],
      skills: [],
      promptTemplates: [],
    }));
  }
  assert.throws(() => listPiTemplates(root), /Duplicate Pi template id "shared"/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("managed tools preserve the host PATH key and delimiter", () => {
  const env = buildManagedToolEnvironment(
    { Path: "C:\\Windows\\System32" },
    { root: "C:\\Conduit", delimiter: ";", platform: "win32" },
  );
  assert.match(env.Path, /working-files[/\\]\.venv[/\\]Scripts;C:\\Windows\\System32$/);
  assert.equal("PATH" in env, false);
});
