import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { listWorkspaceDirectory, readWorkspaceDiff, readWorkspaceFile, runBoundedGit } from "../src/workspace-inspector.js";

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
  result = await readWorkspaceDiff(root, { includePatch: true });
  assert.equal(result.files[0].status, " M");
  assert.match(result.diff, /Working tree/);
  await run("git", ["add", "tracked.txt"], { cwd: root });
  result = await readWorkspaceDiff(root, { includePatch: true });
  assert.equal(result.files[0].status, "M ");
  assert.match(result.diff, /Staged/);
});

test("workspace inspection shares active overview work and defers patch commands", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-inspection-flight-"));
  const calls = [];
  let releaseOverview;
  const overviewGate = new Promise((resolve) => { releaseOverview = resolve; });
  const runGit = async (_root, args) => {
    calls.push(args.join(" "));
    if (args[0] === "rev-parse" && args.includes("--is-inside-work-tree")) await overviewGate;
    if (args[0] === "status") return { stdout: " M demo.txt\0" };
    if (args[0] === "branch") return { stdout: "main\n" };
    if (args[0] === "log") return { stdout: "*\x1fhash\x1fshort\x1fFixture\x1fConduit\x1f2026-01-01T00:00:00Z" };
    if (args[0] === "diff") return { stdout: args.includes("--cached") ? "staged\n" : "unstaged\n" };
    if (args.includes("@{upstream}")) throw new Error("no upstream");
    return { stdout: "true\n" };
  };
  const first = readWorkspaceDiff(root, { runGit });
  const second = readWorkspaceDiff(root, { runGit });
  await new Promise((resolve) => setTimeout(resolve, 10));
  releaseOverview();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(left.repository, true);
  assert.deepEqual(right.files, left.files);
  assert.equal(calls.filter((call) => call.includes("--is-inside-work-tree")).length, 1);
  assert.equal(calls.filter((call) => call.startsWith("diff ")).length, 0);

  const patch = await readWorkspaceDiff(root, { includePatch: true, reuse: true, runGit });
  assert.match(patch.diff, /# Staged/);
  assert.match(patch.diff, /# Working tree/);
  assert.equal(calls.filter((call) => call.startsWith("diff ")).length, 2);
});

test("bounded Git commands honour cancellation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-inspection-abort-"));
  await run("git", ["init", "-q"], { cwd: root });
  const controller = new AbortController();
  const pending = runBoundedGit(root, ["-c", "alias.wait=!sleep 5", "wait"], { signal: controller.signal, timeoutMs: 5_000 });
  setTimeout(() => controller.abort(), 25);
  await assert.rejects(pending, { code: "workspace_inspection_aborted" });
});
