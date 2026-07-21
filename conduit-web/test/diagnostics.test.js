import assert from "node:assert/strict";
import test from "node:test";
import { projectDiagnostics } from "../src/diagnostics.js";

const sortedKeys = (value) => Object.keys(value).sort();

test("projectDiagnostics constructs only the safe diagnostics projection", () => {
  const result = projectDiagnostics({
    installations: [{
      id: "conduit-pinned",
      label: "Isolated Pi",
      available: true,
      compatible: true,
      version: "0.80.6",
      source: "bundled",
      executablePath: "/srv/conduit/node_modules/pi/cli.js",
      agentHome: { path: "/srv/conduit/data/pi", source: "bundled", credentials: "secret" },
      checkedAt: "2026-07-20T12:00:00.000Z",
      error: null,
      command: "/secret/command",
      commandArgs: ["--secret"],
      args: ["--other-secret"],
      environment: { API_KEY: "secret-environment" },
      credentials: { token: "secret-credential" },
      models: { enabledModels: ["private/model"] },
      capabilities: { mode: true },
    }],
    processes: [{
      id: "process-1",
      chatId: "chat-1",
      projectId: "project-1",
      status: "running",
      activity: "working",
      runtime: { installationId: "conduit-pinned", command: "/secret/runtime-command" },
      clientCount: 2,
      generation: { id: "generation-1", closed: false, settled: false, prompt: "private prompt" },
      queue: { steer: [{ message: "private queue" }] },
      hostUiRequests: [{ message: "private host UI" }],
      sessionFile: "/srv/conduit/data/pi/sessions/project/private-transcript.jsonl",
      transcriptFilename: "private-transcript.jsonl",
      cwd: "/private/workspace",
      environment: { TOKEN: "secret-process-environment" },
    }],
    projects: [{
      id: "project-1",
      path: "/srv/conduit/data/chat/files/project-1",
      sessionsDir: "/srv/conduit/data/pi/sessions/project-1",
      directoryListing: ["private.txt"],
    }],
    config: {
      dataRoot: "/srv/conduit/data",
      workspaceAllowlist: ["/private/workspace"],
      credentials: { password: "secret-config" },
      arbitraryConfig: "must-not-leak",
      directoryListing: ["config-private.txt"],
    },
  });

  assert.deepEqual(sortedKeys(result), ["installations", "processes", "storage"]);
  assert.deepEqual(sortedKeys(result.installations[0]), [
    "agentHome",
    "available",
    "checkedAt",
    "compatible",
    "error",
    "executablePath",
    "id",
    "label",
    "source",
    "version",
  ]);
  assert.deepEqual(sortedKeys(result.installations[0].agentHome), ["path", "source"]);
  assert.deepEqual(result.installations[0], {
    id: "conduit-pinned",
    label: "Isolated Pi",
    available: true,
    compatible: true,
    version: "0.80.6",
    source: "bundled",
    executablePath: "/srv/conduit/node_modules/pi/cli.js",
    agentHome: { path: "/srv/conduit/data/pi", source: "bundled" },
    checkedAt: "2026-07-20T12:00:00.000Z",
    error: null,
  });

  assert.deepEqual(sortedKeys(result.processes[0]), [
    "activity",
    "chatId",
    "clientCount",
    "generation",
    "id",
    "installationId",
    "projectId",
    "status",
  ]);
  assert.deepEqual(result.processes[0], {
    id: "process-1",
    chatId: "chat-1",
    projectId: "project-1",
    status: "running",
    activity: "working",
    installationId: "conduit-pinned",
    clientCount: 2,
    generation: {
      id: "generation-1",
      active: true,
      closed: false,
      settled: false,
    },
  });

  assert.deepEqual(result.storage, {
    dataRoot: "/srv/conduit/data",
    transcriptRoots: ["/srv/conduit/data/pi/sessions/project-1"],
    uploadRoots: ["/srv/conduit/data/chat/files/project-1/.conduit/chats"],
  });

  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "secret-command",
    "secret-environment",
    "secret-credential",
    "private queue",
    "private host UI",
    "private-transcript.jsonl",
    "private/workspace",
    "private.txt",
    "secret-config",
    "must-not-leak",
    "config-private.txt",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `leaked ${forbidden}`);
  }
});

test("projectDiagnostics tolerates missing collections and deduplicates storage roots", () => {
  assert.deepEqual(projectDiagnostics({
    installations: null,
    processes: undefined,
    projects: [
      { path: "/work/a", sessionsDir: "/sessions/a" },
      { path: "/work/a/", sessionsDir: "/sessions/a/" },
      { path: null, sessionsDir: "" },
    ],
    config: {},
  }), {
    installations: [],
    processes: [],
    storage: {
      dataRoot: null,
      transcriptRoots: ["/sessions/a"],
      uploadRoots: ["/work/a/.conduit/chats"],
    },
  });
});
