import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionRegistry } from "../src/session-registry.js";
import { sessionDirectoryFor } from "../src/session-store.js";

test("reconciles native files once and serves lightweight session metadata", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-registry-test-"));
  const projectPath = path.join(root, "files");
  const sessionsDir = sessionDirectoryFor(projectPath, path.join(root, "pi"));
  const project = { id: "project_test", slug: "test", path: projectPath, sessionsDir };
  await fs.mkdir(sessionsDir, { recursive: true });
  const sessionFile = path.join(sessionsDir, "session.jsonl");
  await fs.writeFile(sessionFile, [
    JSON.stringify({ type: "session", id: "session-test", cwd: projectPath, timestamp: "2026-01-01T00:00:00Z" }),
    JSON.stringify({ type: "message", message: { role: "user", content: "Registry title" } }),
  ].join("\n"));

  const file = path.join(root, "sessions.json");
  const registry = new SessionRegistry(file);
  await registry.initialize([project]);
  assert.equal(registry.listProject(project.id)[0].title, "Registry title");
  assert.equal((await registry.find([project], "session-test")).file, sessionFile);
  assert.equal((await fs.readFile(file, "utf8")).includes("entries"), false);
  await assert.rejects(fs.access(`${file}.tmp`), { code: "ENOENT" });

  await fs.rm(sessionFile);
  const restored = new SessionRegistry(file);
  await restored.initialize([project]);
  assert.deepEqual(restored.list(), []);
  await fs.rm(root, { recursive: true, force: true });
});
