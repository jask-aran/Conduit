import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { listWorkspaceDirectory, readWorkspaceDiff, readWorkspaceFile } from "../src/workspace-inspector.js";

const run = promisify(execFile);

test("workspace tree and text preview hide internals and fail closed on unsafe paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-inspector-"));
  await fs.mkdir(path.join(root, "src"));
  await fs.mkdir(path.join(root, ".conduit"));
  await fs.writeFile(path.join(root, "src", "main.js"), "export const answer = 42;\n");
  await fs.symlink("/etc/passwd", path.join(root, "escape"));
  assert.deepEqual((await listWorkspaceDirectory(root)).map((entry) => entry.name), ["src"]);
  assert.equal((await readWorkspaceFile(root, "src/main.js")).content, "export const answer = 42;\n");
  await assert.rejects(readWorkspaceFile(root, "../secret"), { code: "invalid_workspace_path" });
  await assert.rejects(readWorkspaceFile(root, ".conduit/private"), { code: "hidden_workspace_path" });
  await assert.rejects(readWorkspaceFile(root, "escape"), { code: "workspace_path_symlink" });
});

test("workspace diff reports clean, dirty, staged, and non-git roots", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-diff-"));
  assert.deepEqual(await readWorkspaceDiff(root), { repository: false, files: [], diff: "" });
  await run("git", ["init", "-q"], { cwd: root });
  await run("git", ["config", "user.email", "test@conduit.local"], { cwd: root });
  await run("git", ["config", "user.name", "Conduit Test"], { cwd: root });
  await fs.writeFile(path.join(root, "tracked.txt"), "one\n");
  await run("git", ["add", "tracked.txt"], { cwd: root });
  await run("git", ["commit", "-qm", "fixture"], { cwd: root });
  let result = await readWorkspaceDiff(root);
  assert.equal(result.repository, true);
  assert.ok(result.branch);
  assert.equal(result.files.length, 0);
  assert.equal(result.commits[0].subject, "fixture");
  await fs.writeFile(path.join(root, "tracked.txt"), "one\ntwo\n");
  result = await readWorkspaceDiff(root);
  assert.equal(result.files[0].status, " M");
  assert.match(result.diff, /Working tree/);
  await run("git", ["add", "tracked.txt"], { cwd: root });
  result = await readWorkspaceDiff(root);
  assert.equal(result.files[0].status, "M ");
  assert.match(result.diff, /Staged/);
});
