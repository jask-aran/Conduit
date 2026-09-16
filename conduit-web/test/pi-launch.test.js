import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolvePiLaunch } from "../src/pi-launch.js";

const project = { id: "project_workspace", path: "/tmp/stale-workspace", workingRoot: "/tmp/workspace" };
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

test("Conduit Pi launch uses the pinned installation and Conduit-owned agent home", () => {
  const chat = {
    runtime: {
      kind: "conduit_profile",
      installationId: "conduit-pinned",
      binaryVersion: "0.84.1",
      profileId: "workspace",
      profileVersion: "2",
    },
    backend: { implementation: "conduit_pi", opaqueSession: "/tmp/sessions/chat.jsonl" },
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
  assert.equal(launch.cwd, path.resolve(project.workingRoot));
  assert.equal(launch.env.PI_CODING_AGENT_DIR, path.resolve("/var/lib/conduit/pi"));
  assert.match(launch.env.PATH, /^.*working-files[/\\]\.venv[/\\]bin:/);
  assert.ok(launch.args.includes("--system-prompt"));
  assert.ok(launch.args.includes("--no-extensions"));
  assert.ok(launch.args.includes("--session"));
});

test("Unavailable installations fail closed without substituting another Pi", () => {
  assert.throws(() => resolvePiLaunch({
    chat: { runtime: { kind: "conduit_profile" } },
    project,
    installation: { available: false, error: "missing" },
  }), { code: "runtime_version_unavailable" });
});
