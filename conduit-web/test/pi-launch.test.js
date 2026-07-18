import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolvePiLaunch } from "../src/pi-launch.js";

const project = { id: "project_workspace", path: "/tmp/workspace" };
const template = {
  id: "workspace",
  version: "2",
  systemPrompt: "/tmp/template/SYSTEM.md",
  tools: ["read", "bash"],
  models: [],
  extensions: [],
  skills: [],
  promptTemplates: [],
};

test("Conduit profile launch uses the pinned installation and isolated agent home", () => {
  const chat = {
    runtime: {
      kind: "conduit_profile",
      installationId: "conduit-pinned",
      binaryVersion: "0.80.6",
      profileId: "workspace",
      profileVersion: "2",
    },
    piSessionFile: "/tmp/sessions/chat.jsonl",
  };
  const launch = resolvePiLaunch({
    chat,
    project,
    installation: {
      available: true,
      command: "/opt/conduit/pi/0.80.6/pi",
      commandArgs: [],
      agentDir: "/var/lib/conduit/pi",
    },
    template,
    models: ["openai/gpt"],
    model: "openai/gpt",
  });
  assert.equal(launch.command, "/opt/conduit/pi/0.80.6/pi");
  assert.equal(launch.cwd, path.resolve(project.path));
  assert.equal(launch.env.PI_CODING_AGENT_DIR, "/var/lib/conduit/pi");
  assert.ok(launch.args.includes("--system-prompt"));
  assert.ok(launch.args.includes("--no-extensions"));
  assert.ok(launch.args.includes("--session"));
});

test("Native Pi launch uses host state and only the additive Conduit bridge", () => {
  const chat = {
    runtime: {
      kind: "native_pi",
      installationId: "host-pi",
      binaryVersion: "0.80.10",
      profileId: null,
      profileVersion: null,
    },
    piSessionFile: null,
  };
  const launch = resolvePiLaunch({
    chat,
    project,
    installation: {
      available: true,
      command: "/home/user/.local/bin/pi",
      commandArgs: [],
      agentDir: "/home/user/.pi/agent",
    },
    trustChoice: "trusted_once",
    bridgeSystemPrompt: "/repo/templates/conduit-workspace/SYSTEM.md",
    bridgeSkill: "/repo/templates/conduit-workspace/SKILL.md",
  });
  assert.equal(launch.command, "/home/user/.local/bin/pi");
  assert.equal("PI_CODING_AGENT_DIR" in launch.env, false);
  assert.ok(launch.args.includes("--approve"));
  assert.ok(launch.args.includes("--append-system-prompt"));
  assert.ok(launch.args.includes("--skill"));
  assert.equal(launch.args.includes("--system-prompt"), false);
  assert.equal(launch.args.includes("--tools"), false);
  assert.equal(launch.args.includes("--models"), false);
  assert.equal(launch.trustPosture, "trusted_once");
});

test("Unavailable installations fail closed without substituting another Pi", () => {
  assert.throws(() => resolvePiLaunch({
    chat: { runtime: { kind: "native_pi" } },
    project,
    installation: { available: false, error: "missing" },
  }), { code: "native_pi_unavailable" });
});
