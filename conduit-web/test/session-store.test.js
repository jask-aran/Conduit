import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  discoverSessions,
  findSession,
  removeSession,
  removeSessionFamily,
  sessionDirectoryFor,
  sessionFamilyFiles,
} from "../src/session-store.js";

test("discovers cwd-matched sessions in Pi's native agent-home layout", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-session-test-"));
  const projectRoot = path.join(root, "data/chat/files/example");
  const sessionsDir = sessionDirectoryFor(projectRoot, path.join(root, "data/pi"));
  await fs.mkdir(sessionsDir, { recursive: true });
  const file = path.join(sessionsDir, "session.jsonl");
  await fs.writeFile(file, [
    JSON.stringify({ type: "session", id: "session-native-1", timestamp: "2026-01-01T00:00:00Z", cwd: projectRoot }),
    JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "Hello Pi" }] } }),
  ].join("\n"));
  const projects = [{ id: "project_example", slug: "example", path: projectRoot, workingRoot: projectRoot, sessionsDir }];
  const sessions = await discoverSessions(projects);
  assert.equal(sessions[0].title, "Hello Pi");
  assert.equal((await findSession(projects, sessions[0].id)).file, file);
  assert.equal(await findSession(projects, "../../etc/passwd"), null);
  await fs.rm(root, { recursive: true, force: true });
});

test("filters cwd collisions from Pi's encoded session directories", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-session-collision-test-"));
  const firstPath = path.join(root, "a-b/c");
  const secondPath = path.join(root, "a/b-c");
  const piAgentDir = path.join(root, "pi");
  const sessionsDir = sessionDirectoryFor(firstPath, piAgentDir);
  assert.equal(sessionsDir, sessionDirectoryFor(secondPath, piAgentDir));
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.writeFile(path.join(sessionsDir, "first.jsonl"), `${JSON.stringify({ type: "session", id: "session-first", cwd: firstPath })}\n`);
  await fs.writeFile(path.join(sessionsDir, "second.jsonl"), `${JSON.stringify({ type: "session", id: "session-second", cwd: secondPath })}\n`);

  const projects = [{ id: "project_first", slug: "first", path: firstPath, workingRoot: firstPath, sessionsDir }];
  const sessions = await discoverSessions(projects);
  assert.deepEqual(sessions.map((session) => session.id), ["session-first"]);
  await fs.rm(root, { recursive: true, force: true });
});

test("deletes a discovered native session file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-session-delete-test-"));
  const file = path.join(root, "session.jsonl");
  await fs.writeFile(file, "{}\n");
  await removeSession({ file });
  await assert.rejects(fs.access(file), { code: "ENOENT" });
  await fs.rm(root, { recursive: true, force: true });
});

test("deletes a Pi fork family without touching unrelated session trees", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-session-family-delete-test-"));
  const projectPath = path.join(root, "project");
  const sessionsDir = sessionDirectoryFor(projectPath, path.join(root, "pi"));
  const project = { id: "project_family", slug: "family", path: projectPath, workingRoot: projectPath, sessionsDir };
  await fs.mkdir(sessionsDir, { recursive: true });
  const original = path.join(sessionsDir, "original.jsonl");
  const branch = path.join(sessionsDir, "branch.jsonl");
  const sibling = path.join(sessionsDir, "sibling.jsonl");
  const unrelated = path.join(sessionsDir, "unrelated.jsonl");
  const writeHeader = (file, id, parentSession = null) => fs.writeFile(file, `${JSON.stringify({
    type: "session", id, timestamp: "2026-01-01T00:00:00Z", cwd: projectPath, ...(parentSession ? { parentSession } : {}),
  })}\n`);
  await Promise.all([
    writeHeader(original, "original"),
    writeHeader(branch, "branch", original),
    writeHeader(sibling, "sibling", original),
    writeHeader(unrelated, "unrelated"),
  ]);

  assert.deepEqual(new Set(await sessionFamilyFiles(branch, project)), new Set([original, branch, sibling]));
  await removeSessionFamily(branch, project);
  await Promise.all([original, branch, sibling].map((file) => assert.rejects(fs.access(file), { code: "ENOENT" })));
  await fs.access(unrelated);
  await fs.rm(root, { recursive: true, force: true });
});

test("deletes nested agent-dir sessions only under the installation root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-profile-session-family-test-"));
  const projectPath = path.join(root, "project");
  const installationRoot = path.join(root, "pi");
  const profileAgentDir = path.join(installationRoot, "nested", "agent");
  const sessionsDir = sessionDirectoryFor(projectPath, profileAgentDir);
  const project = { id: "project_profile", slug: "profile", path: projectPath, workingRoot: projectPath, sessionsDir };
  await fs.mkdir(sessionsDir, { recursive: true });
  const file = path.join(sessionsDir, "profile-session.jsonl");
  await fs.writeFile(file, `${JSON.stringify({ type: "session", id: "profile-session", timestamp: "2026-01-01T00:00:00Z", cwd: projectPath })}\n`);

  assert.deepEqual(await sessionFamilyFiles(file, project, { sessionsDir, allowedRoot: installationRoot }), [file]);
  await assert.rejects(
    sessionFamilyFiles(file, project, { sessionsDir, allowedRoot: path.join(root, "other") }),
    { code: "invalid_session_mapping" },
  );
  await fs.rm(root, { recursive: true, force: true });
});
