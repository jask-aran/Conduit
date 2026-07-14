import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { buildPiArgs } from "../src/pi-manager.js";

test("Pi launch arguments disable ambient discovery and load only the repo profile", () => {
  const project = { sessionsDir: "/tmp/project/.conduit/sessions" };
  const profile = {
    systemPrompt: "/repo/phase-0-custom/pi/SYSTEM.md",
    tools: ["read", "bash"],
    extensions: ["/repo/phase-0-custom/pi/extensions/example.ts"],
    skills: ["/repo/phase-0-custom/pi/skills/example"],
    promptTemplates: [],
  };
  const args = buildPiArgs({ project, profile, model: "openai/gpt:high" });
  for (const flag of ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files"]) {
    assert.ok(args.includes(flag), `missing ${flag}`);
  }
  assert.deepEqual(args.slice(args.indexOf("--system-prompt"), args.indexOf("--system-prompt") + 2), ["--system-prompt", profile.systemPrompt]);
  assert.ok(args.includes("/repo/phase-0-custom/pi/extensions/example.ts"));
  assert.ok(args.includes("/repo/phase-0-custom/pi/skills/example"));
  assert.equal(args[args.indexOf("--tools") + 1], "read,bash");
  assert.equal(args[args.indexOf("--model") + 1], "openai/gpt:high");
  assert.equal(args.includes(path.join(process.env.HOME || "", ".pi/agent/extensions")), false);
});
