import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { buildPiArgs, PiManager } from "../src/pi-manager.js";
import { buildPiEnvironment, loadPiModelPatterns } from "../../scripts/pi-runtime.mjs";

test("Pi launch arguments use native session storage and load only the selected template", () => {
  const template = {
    id: "chat",
    version: "1",
    systemPrompt: "/repo/templates/chat/SYSTEM.md",
    tools: ["read", "bash"],
    models: ["openai/gpt", "anthropic/claude"],
    extensions: ["/repo/templates/chat/extensions/example.ts"],
    skills: ["/repo/templates/chat/skills/example"],
    promptTemplates: [],
  };
  const args = buildPiArgs({ template, model: "openai/gpt", thinkingLevel: "high" });
  for (const flag of ["--no-approve", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files"]) {
    assert.ok(args.includes(flag), `missing ${flag}`);
  }
  assert.equal(args.includes("--session-dir"), false);
  assert.deepEqual(args.slice(args.indexOf("--system-prompt"), args.indexOf("--system-prompt") + 2), ["--system-prompt", template.systemPrompt]);
  assert.ok(args.includes("/repo/templates/chat/extensions/example.ts"));
  assert.ok(args.includes("/repo/templates/chat/skills/example"));
  assert.equal(args[args.indexOf("--tools") + 1], "read,bash");
  assert.equal(args[args.indexOf("--models") + 1], "openai/gpt,anthropic/claude");
  assert.equal(args[args.indexOf("--model") + 1], "openai/gpt");
  assert.equal(args[args.indexOf("--thinking") + 1], "high");
  assert.equal(args.includes(path.join(process.env.HOME || "", ".pi/agent/extensions")), false);
});

test("Pi runtime environment uses the Conduit-owned agent directory", () => {
  const env = buildPiEnvironment("/repo/data/pi", {
    PATH: "/bin",
    PI_CODING_AGENT_DIR: "/home/user/.pi/agent",
    PI_CODING_AGENT_SESSION_DIR: "/tmp/flat-sessions",
  });
  assert.equal(env.PI_CODING_AGENT_DIR, "/repo/data/pi");
  assert.equal("PI_CODING_AGENT_SESSION_DIR" in env, false);
  assert.equal(env.PATH, "/bin");
});

test("Pi launch arguments can narrow the template model scope", () => {
  const template = {
    id: "test",
    version: "1",
    systemPrompt: "/tmp/SYSTEM.md",
    tools: ["read"],
    models: ["openai/gpt", "anthropic/claude"],
    extensions: [],
    skills: [],
    promptTemplates: [],
  };

  const args = buildPiArgs({ template, models: ["anthropic/claude"] });

  assert.equal(args[args.indexOf("--models") + 1], "anthropic/claude");
});

test("terminal launcher model patterns prefer Pi's latest saved scope", () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "conduit-pi-models-"));
  fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({
    enabledModels: ["anthropic/haiku"],
  }));

  assert.deepEqual(loadPiModelPatterns(agentDir, ["openai/gpt"]), ["anthropic/haiku"]);
  assert.deepEqual(loadPiModelPatterns(path.join(agentDir, "missing"), ["openai/gpt"]), ["openai/gpt"]);
});

test("a stopped persisted session can be resumed in a fresh Pi process", async () => {
  const children = [];
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = { write() {} };
    child.kill = (signal) => {
      queueMicrotask(() => child.emit("exit", 0, signal));
      return true;
    };
    children.push(child);
    return child;
  };
  const manager = new PiManager({
    agentDir: "/tmp/conduit-pi-manager-test",
    spawnImpl,
    template: { id: "test", version: "1", models: [], tools: [], extensions: [], skills: [], promptTemplates: [] },
  });
  const project = { id: "project_test", slug: "test", path: "/tmp/project", sessionsDir: "/tmp/sessions" };
  const first = manager.create({ project, sessionFile: "/tmp/sessions/session.jsonl" });
  await manager.stopAndWait(first.id);
  const second = manager.create({ project, sessionFile: "/tmp/sessions/session.jsonl" });

  assert.equal(children.length, 2);
  assert.notEqual(second.child, first.child);
  assert.equal(manager.list().length, 1);
});
