import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  deleteWorkspaceFile,
  listWorkspaceDirectory,
  readWorkspaceDiff,
  readWorkspaceFile,
  runWorkspaceGitAction,
  writeWorkspaceFile,
} from "../src/workspace-inspector.js";

const run = promisify(execFile);

test("workspace tree and text preview hide internals and fail closed on unsafe paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-inspector-"));
  await fs.mkdir(path.join(root, "src"));
  await fs.mkdir(path.join(root, ".conduit"));
  await fs.writeFile(path.join(root, "src", "main.js"), "export const answer = 42;\n");
  await fs.symlink("/etc/passwd", path.join(root, "escape"));
  const listing = await listWorkspaceDirectory(root);
  assert.deepEqual(listing.entries.map((entry) => entry.name), ["src"]);
  assert.equal(listing.truncated, false);
  assert.equal((await readWorkspaceFile(root, "src/main.js")).content, "export const answer = 42;\n");
  await assert.rejects(readWorkspaceFile(root, "../secret"), { code: "invalid_workspace_path" });
  await assert.rejects(readWorkspaceFile(root, ".conduit/private"), { code: "hidden_workspace_path" });
  await assert.rejects(readWorkspaceFile(root, "escape"), { code: "workspace_path_symlink" });
});

test("direct inspector calls reject a symlinked workspace root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-inspector-root-link-"));
  const outside = path.join(root, "outside");
  const linked = path.join(root, "linked");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "secret.txt"), "outside");
  await fs.symlink(outside, linked);
  await assert.rejects(listWorkspaceDirectory(linked), { code: "unsafe_workspace_root" });
  assert.equal(await fs.readFile(path.join(outside, "secret.txt"), "utf8"), "outside");
});

test("workspace writes create files and reject stale or implicit overwrites", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-inspector-write-"));
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src", "main.js"), "one\n");
  const current = await readWorkspaceFile(root, "src/main.js");
  const saved = await writeWorkspaceFile(root, "src/main.js", Buffer.from("two\n"), { expectedRevision: current.revision });
  assert.equal((await readWorkspaceFile(root, "src/main.js")).content, "two\n");
  assert.notEqual(saved.revision, current.revision);
  await assert.rejects(writeWorkspaceFile(root, "src/main.js", Buffer.from("stale\n"), { expectedRevision: current.revision }), { code: "workspace_file_changed" });
  await writeWorkspaceFile(root, "src/new.txt", Buffer.from("new\n"));
  await assert.rejects(writeWorkspaceFile(root, "src/new.txt", Buffer.from("replace\n")), { code: "workspace_file_exists" });
  await writeWorkspaceFile(root, "src/new.txt", Buffer.from("replace\n"), { expectedRevision: "*" });
  assert.equal((await readWorkspaceFile(root, "src/new.txt")).content, "replace\n");
  await deleteWorkspaceFile(root, "src/new.txt");
  await assert.rejects(fs.access(path.join(root, "src", "new.txt")), { code: "ENOENT" });
  await assert.rejects(writeWorkspaceFile(root, "src/new.txt", Buffer.from("missing\n"), { expectedRevision: "*" }), { code: "workspace_file_changed" });
  await assert.rejects(deleteWorkspaceFile(root, "src"), { code: "path_not_file" });
  await assert.rejects(writeWorkspaceFile(root, ".conduit/private.txt", Buffer.from("no\n")), { code: "hidden_workspace_path" });
});

test("workspace Git actions stage, unstage, and commit without changing file contents", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-git-actions-"));
  await run("git", ["init", "-q"], { cwd: root });
  await run("git", ["config", "user.email", "test@conduit.local"], { cwd: root });
  await run("git", ["config", "user.name", "Conduit Test"], { cwd: root });
  await fs.writeFile(path.join(root, "tracked.txt"), "one\n");
  await runWorkspaceGitAction(root, { action: "stage", relativePath: "tracked.txt" });
  assert.equal((await readWorkspaceDiff(root)).files[0].status, "A ");
  await runWorkspaceGitAction(root, { action: "commit", message: "Initial commit" });
  await fs.writeFile(path.join(root, "tracked.txt"), "two\n");
  await runWorkspaceGitAction(root, { action: "stage-all" });
  assert.equal((await readWorkspaceDiff(root)).files[0].status, "M ");
  await runWorkspaceGitAction(root, { action: "unstage-all" });
  assert.equal((await readWorkspaceDiff(root)).files[0].status, " M");
  assert.equal(await fs.readFile(path.join(root, "tracked.txt"), "utf8"), "two\n");
});
