import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { buildPiArgs } from "../src/pi-manager.js";
import { buildPiEnvironment } from "../../scripts/pi-runtime.mjs";

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
