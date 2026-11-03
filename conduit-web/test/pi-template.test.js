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
  assert.equal(new Set(templates.map((template) => template.id)).size, templates.length);
  for (const template of templates) {
    assert.equal(typeof template.version, "string");
    assert.ok(template.version.trim());
    const declared = JSON.parse(fs.readFileSync(template.templateFile, "utf8"));
    const view = templatePublicView(template);
    assert.equal(view.id, template.id);
    assert.equal(view.version, template.version);
    assert.equal(view.label, declared.label || declared.id);
    assert.ok(view.label.trim());
    assert.equal(view.defaultable, declared.defaultable !== false);
    assert.deepEqual(view.tools, declared.tools);
    assert.deepEqual(view.models, declared.models);
    assert.equal(view.extensionCount, template.extensions.length);
    assert.equal(view.skillCount, template.skills.length);
    assert.equal(view.promptTemplateCount, template.promptTemplates.length);
    for (const key of ["extensions", "skills", "promptTemplates"]) {
      assert.deepEqual(template[key], declared[key].map((resource) => path.resolve(path.dirname(template.templateFile), resource)));
    }
    for (const resource of [...template.extensions, ...template.skills, ...template.promptTemplates]) {
      assert.ok(fs.existsSync(resource), resource);
    }
    assert.ok(fs.readFileSync(template.systemPrompt, "utf8").trim(), template.systemPrompt);
  }
  const coding = templates.find((template) => template.id === "coding");
  assert.ok(coding.skills.length > 0);
  assert.equal(templatePublicView(coding).defaultable, true);
  assert.equal(templatePublicView(templates.find((template) => template.id === "assistant")).defaultable, true);
  assert.equal(templatePublicView(templates.find((template) => template.id === "runtime")).defaultable, false);
  const assistant = templates.find((template) => template.id === "assistant");
  const basePrompt = fs.readFileSync(assistant.basePrompt, "utf8");
  assert.match(basePrompt, /bash[^\n]*code.mode/i);
  assert.match(basePrompt, /python[^\n]*bash/i);
  const web = fs.readFileSync(path.resolve(root, "conduit-runtime/WEB.md"), "utf8");
  assert.match(web, /web_search[\s\S]*fetch_content/i);
  assert.match(web, /fetch_content[^\n]*inspect/i);
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
