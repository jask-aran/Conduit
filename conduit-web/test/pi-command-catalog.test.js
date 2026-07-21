import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  discoverTemplateCommands,
  normalizeRpcCommands,
  resolvePiCommandCatalog,
} from "../src/pi-command-catalog.js";

async function temporaryTemplate(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-command-catalog-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function writeFile(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

test("normalizeRpcCommands preserves order, keeps first duplicate, and strips private metadata", () => {
  const commands = normalizeRpcCommands([{
    name: "/review",
    description: "Review the current changes",
    source: "prompt",
    sourceInfo: { path: "/private/prompts/review.md" },
    filePath: "/private/prompts/review.md",
  }, {
    name: "review",
    description: "Later duplicate",
    source: "extension",
  }, {
    name: "deploy",
    description: "Deploy the application",
    source: "extension",
    path: "/private/extensions/deploy.js",
  }, {
    name: "skill:research",
    description: "Research a topic",
    source: "skill",
    sourceInfo: { baseDir: "/private/skills/research" },
  }, {
    name: "///",
    description: "Invalid",
    source: "prompt",
  }, {
    name: "unknown",
    description: "Invalid source",
    source: "builtin",
  }]);

  assert.deepEqual(commands, [{
    name: "review",
    description: "Review the current changes",
    source: "prompt",
    dispatch: "insert",
  }, {
    name: "deploy",
    description: "Deploy the application",
    source: "extension",
    dispatch: "prompt",
  }, {
    name: "skill:research",
    description: "Research a topic",
    source: "skill",
    dispatch: "prompt",
  }]);
});

test("a successful empty RPC command list is authoritative", async (t) => {
  const templateDir = await temporaryTemplate(t);
  await writeFile(path.join(templateDir, "prompts", "fallback.md"), "Fallback prompt\n");

  const commands = await resolvePiCommandCatalog({
    rpcCommands: [],
    templateDir,
    manifest: { promptTemplates: ["prompts/fallback.md"] },
  });

  assert.deepEqual(commands, []);
});

test("prompt-template fallback uses manifest order and safe descriptions", async (t) => {
  const templateDir = await temporaryTemplate(t);
  await writeFile(path.join(templateDir, "prompts", "review.md"), [
    "---",
    "description: Review the current changes",
    "---",
    "Inspect the diff.",
  ].join("\n"));
  await writeFile(path.join(templateDir, "prompts", "explain.md"), "Explain this code in plain language.\nMore detail.\n");
  await writeFile(path.join(templateDir, "later", "review.md"), "Duplicate review\n");

  const commands = await discoverTemplateCommands({
    templateDir,
    manifest: {
      promptTemplates: ["prompts/review.md", "prompts/explain.md", "later/review.md"],
      skills: [],
      extensionCommands: [],
    },
  });

  assert.deepEqual(commands, [{
    name: "review",
    description: "Review the current changes",
    source: "prompt",
    dispatch: "insert",
  }, {
    name: "explain",
    description: "Explain this code in plain language.",
    source: "prompt",
    dispatch: "insert",
  }]);
});

test("skill fallback recursively discovers SKILL.md metadata", async (t) => {
  const templateDir = await temporaryTemplate(t);
  await writeFile(path.join(templateDir, "skills", "collection", "research", "SKILL.md"), [
    "---",
    "name: deep-research",
    "description: Research a topic using multiple sources",
    "---",
    "# Instructions",
  ].join("\n"));
  await writeFile(path.join(templateDir, "skills", "collection", "ignored", "SKILL.md"), [
    "---",
    "name: ignored",
    "---",
    "Missing description",
  ].join("\n"));

  const commands = await discoverTemplateCommands({
    templateDir,
    manifest: { promptTemplates: [], skills: ["skills/collection"] },
  });

  assert.deepEqual(commands, [{
    name: "skill:deep-research",
    description: "Research a topic using multiple sources",
    source: "skill",
    dispatch: "prompt",
  }]);
});

test("extension fallback reads only explicit static manifest command metadata", async (t) => {
  const templateDir = await temporaryTemplate(t);
  await writeFile(path.join(templateDir, "extensions", "unsafe.js"), [
    "throw new Error('must not execute');",
    "pi.registerCommand('hidden-source-command', { description: 'Do not parse me' });",
  ].join("\n"));

  const commands = await discoverTemplateCommands({
    templateDir,
    manifest: {
      extensions: ["extensions/unsafe.js"],
      extensionCommands: [{ name: "/deploy", description: "Deploy safely" }],
    },
  });

  assert.deepEqual(commands, [{
    name: "deploy",
    description: "Deploy safely",
    source: "extension",
    dispatch: "prompt",
  }]);
});

test("static extension metadata can be read from template.json without exposing paths", async (t) => {
  const templateDir = await temporaryTemplate(t);
  await writeFile(path.join(templateDir, "template.json"), JSON.stringify({
    extensionCommands: [{ name: "diagnose", description: "Run diagnostics" }],
  }));

  const commands = await discoverTemplateCommands({
    templateDir,
    manifest: { extensions: [path.join(templateDir, "extensions", "diagnose.js")] },
  });

  assert.deepEqual(commands, [{
    name: "diagnose",
    description: "Run diagnostics",
    source: "extension",
    dispatch: "prompt",
  }]);
});

test("missing and malformed fallback resources contribute no commands", async (t) => {
  const templateDir = await temporaryTemplate(t);
  await writeFile(path.join(templateDir, "prompts", "broken.md"), "---\ndescription: [unterminated\n---\nBody\n");
  await writeFile(path.join(templateDir, "skills", "broken", "SKILL.md"), "---\ndescription: [unterminated\n---\nBody\n");
  await writeFile(path.join(templateDir, "template.json"), "{not json");

  const commands = await discoverTemplateCommands({
    templateDir,
    manifest: {
      promptTemplates: ["prompts/broken.md", "prompts/missing.md"],
      skills: ["skills/broken", "skills/missing"],
      extensionCommands: "not-an-array",
    },
  });

  assert.deepEqual(commands, []);
});

test("Host Pi has an empty fallback when RPC commands are unavailable", async (t) => {
  const templateDir = await temporaryTemplate(t);
  await writeFile(path.join(templateDir, "prompts", "fallback.md"), "Fallback prompt\n");

  const commands = await resolvePiCommandCatalog({
    rpcCommands: null,
    templateDir,
    manifest: { promptTemplates: ["prompts/fallback.md"] },
    hostMode: true,
  });

  assert.deepEqual(commands, []);
});
