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

test("Isolated Pi profile launch uses the pinned installation and isolated agent home", () => {
  const chat = {
    runtime: {
      kind: "conduit_profile",
      installationId: "conduit-pinned",
      binaryVersion: "0.84.1",
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
      command: "/opt/conduit/pi/0.84.1/pi",
      commandArgs: [],
      agentDir: "/var/lib/conduit/pi",
    },
    template,
    models: ["openai/gpt"],
    model: "openai/gpt",
  });
  assert.equal(launch.command, "/opt/conduit/pi/0.84.1/pi");
  assert.equal(launch.cwd, path.resolve(project.path));
  assert.equal(launch.env.PI_CODING_AGENT_DIR, path.resolve("/var/lib/conduit/pi"));
  assert.match(launch.env.PATH, /^.*working-files[/\\]\.venv[/\\]bin:/);
  assert.ok(launch.args.includes("--system-prompt"));
  assert.ok(launch.args.includes("--no-extensions"));
  assert.ok(launch.args.includes("--session"));
});

test("isolated Pi launch can use a model-profile agent overlay", () => {
  const launch = resolvePiLaunch({
    chat: { runtime: { kind: "conduit_profile", installationId: "conduit-pinned" }, piSessionFile: null },
    project,
    installation: {
      available: true,
      command: "/opt/conduit/pi/0.84.1/pi",
      commandArgs: [],
      agentDir: "/var/lib/conduit/pi",
    },
    template,
    models: ["openai/gpt"],
    model: "openai/gpt",
    runtimeAgentDir: "/var/lib/conduit/pi/model-profiles/openai-search",
    modelProfile: { id: "openai-search", label: "OpenAI search", searchRouting: { providers: ["openai", "brave"], fallbackOn: ["network"] } },
  });
  assert.equal(launch.env.PI_CODING_AGENT_DIR, path.resolve("/var/lib/conduit/pi/model-profiles/openai-search"));
  assert.equal(launch.modelProfile.id, "openai-search");
});

test("Host Pi launch uses host state, a draft model, and only the additive Conduit bridge", () => {
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
      environment: { HOME: "/home/user", PATH: "/home/user/bin:/usr/bin", TOOL_TOKEN: "keep", CONDUIT_SECRET: "strip" },
    },
    model: "example/reasoner",
    thinkingLevel: "high",
    bridgeSystemPrompt: "/repo/templates/conduit-workspace/SYSTEM.md",
    bridgeSkill: "/repo/templates/conduit-workspace/SKILL.md",
  });
  assert.equal(launch.command, "/home/user/.local/bin/pi");
  assert.equal("PI_CODING_AGENT_DIR" in launch.env, false);
  assert.match(launch.env.PATH, /^.*working-files[/\\]\.venv[/\\]bin:\/home\/user\/bin:\/usr\/bin$/);
  assert.equal(launch.env.TOOL_TOKEN, "keep");
  assert.equal("CONDUIT_SECRET" in launch.env, false);
  assert.equal(launch.args.includes("--approve"), false);
  assert.equal(launch.args.includes("--no-approve"), false);
  assert.ok(launch.args.includes("--append-system-prompt"));
  assert.ok(launch.args.includes("--skill"));
  assert.equal(launch.args.includes("--system-prompt"), false);
  assert.equal(launch.args.includes("--tools"), false);
  assert.equal(launch.args.includes("--models"), false);
  assert.deepEqual(launch.args.slice(launch.args.indexOf("--model"), launch.args.indexOf("--model") + 4), ["--model", "example/reasoner", "--thinking", "high"]);
  assert.equal(launch.trustPosture, "native_saved_trust");
});

test("Native Pi launch preserves an explicitly resolved host agent home", () => {
  const launch = resolvePiLaunch({
    chat: { runtime: { kind: "native_pi", installationId: "host-pi" }, piSessionFile: null },
    project,
    installation: {
      available: true,
      command: "/home/user/bin/pi",
      commandArgs: [],
      agentDir: "/mnt/native-pi-home",
      agentDirExplicit: true,
      environment: { HOME: "/home/user", PI_CODING_AGENT_DIR: "/mnt/native-pi-home" },
      version: "0.80.10",
    },
    bridgeSystemPrompt: "/repo/templates/conduit-workspace/SYSTEM.md",
    bridgeSkill: "/repo/templates/conduit-workspace/SKILL.md",
  });
  assert.equal(launch.env.PI_CODING_AGENT_DIR, "/mnt/native-pi-home");
});

test("Unavailable installations fail closed without substituting another Pi", () => {
  assert.throws(() => resolvePiLaunch({
    chat: { runtime: { kind: "native_pi" } },
    project,
    installation: { available: false, error: "missing" },
  }), { code: "native_pi_unavailable" });
});
