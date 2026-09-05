import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  createWorkspaceDirectory,
  closeWorkspaceVersionWatch,
  deleteWorkspaceDirectory,
  deleteWorkspaceFile,
  classifyWorkspaceFile,
  listWorkspaceDirectory,
  moveWorkspaceEntry,
  readWorkspaceDiff,
  readWorkspaceCommit,
  readWorkspaceFile,
  readWorkspaceFileMetadata,
  readWorkspaceVersion,
  MAX_CONCURRENT_GIT_PROCESSES,
  MAX_PREVIEW_BYTES,
  runBoundedGit,
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

test("workspace metadata classifies bounded file kinds and keeps binary reads fail-closed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-inspector-kinds-"));
  await fs.writeFile(path.join(root, "notes.data"), "plain text\n");
  await fs.writeFile(path.join(root, "manual.dat"), "%PDF-1.7\n");
  await fs.writeFile(path.join(root, "sound.dat"), Buffer.from("ID3\u0004\u0000\u0000"));
  await fs.writeFile(path.join(root, "movie.dat"), Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom")]))
  await fs.writeFile(path.join(root, "unknown.bin"), Buffer.from([0x00, 0x01, 0x02, 0x03]));

  assert.deepEqual(classifyWorkspaceFile("manual.dat", Buffer.from("%PDF-1.7")), { kind: "pdf", mime: "application/pdf" });
  assert.deepEqual(classifyWorkspaceFile("image.dat", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), { kind: "image", mime: "image/png" });
  assert.deepEqual(classifyWorkspaceFile("sound.dat", Buffer.from("ID3")), { kind: "audio", mime: "audio/mpeg" });
  assert.deepEqual(classifyWorkspaceFile("movie.dat", Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom")])) , { kind: "video", mime: "video/mp4" });

  const textMetadata = await readWorkspaceFileMetadata(root, "notes.data");
  assert.equal(textMetadata.kind, "text");
  assert.equal(textMetadata.mime, "text/plain");
  assert.equal(typeof textMetadata.revision, "string");
  assert.equal(textMetadata.head, Buffer.from("plain text\n").toString("hex"));

  const binaryMetadata = await readWorkspaceFileMetadata(root, "unknown.bin");
  assert.deepEqual({ kind: binaryMetadata.kind, mime: binaryMetadata.mime }, { kind: "binary", mime: "application/octet-stream" });
  await assert.rejects(readWorkspaceFile(root, "manual.dat"), (error) => error.code === "file_not_text" && error.kind === "pdf" && error.mime === "application/pdf");
  const forced = await readWorkspaceFile(root, "manual.dat", { forceText: true });
  assert.equal(forced.readOnly, true);
  assert.equal(forced.content, "%PDF-1.7\n");

  await fs.writeFile(path.join(root, "large.txt"), Buffer.alloc(MAX_PREVIEW_BYTES + 10, 0x61));
  await assert.rejects(readWorkspaceFile(root, "large.txt"), (error) => error.code === "file_too_large" && error.kind === "text");
  const bounded = await readWorkspaceFile(root, "large.txt", { preview: true });
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.content.length, MAX_PREVIEW_BYTES);
  assert.equal(bounded.readOnly, true);
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

test("oversize directories report the limit without an arbitrary partial listing", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-directory-oversize-"));
  t.mock.method(fs, "opendir", async () => ({
    async *[Symbol.asyncIterator]() {
      for (let index = 0; index <= 50_000; index += 1) yield {
        name: `file-${index}`, isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true,
      };
    },
  }));
  assert.deepEqual(await listWorkspaceDirectory(root), { entries: [], total: null, truncated: false, cursor: null, oversize: true });
});

test("workspace tree pages all 1200 entries in stable order without overlap", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-directory-pages-"));
  for (let index = 1199; index >= 0; index -= 1) {
    await fs.writeFile(path.join(root, `file-${String(index).padStart(4, "0")}`), "");
  }
  const names = [];
  let after;
  do {
    const page = await listWorkspaceDirectory(root, "", { after });
    assert.equal(page.total, 1200);
    assert.equal(page.oversize, false);
    const batch = page.entries.map((entry) => entry.name);
    assert.deepEqual(batch, [...batch].sort());
    assert.equal(batch.length, after ? Math.min(500, 1200 - names.length) : 500);
    names.push(...batch);
    after = page.cursor;
  } while (after);
  assert.equal(new Set(names).size, 1200);
  assert.deepEqual(names, Array.from({ length: 1200 }, (_, index) => `file-${String(index).padStart(4, "0")}`));
  await assert.rejects(listWorkspaceDirectory(root, "", { after: "not-json" }), { code: "invalid_workspace_path" });
});

test("workspace tree bounds accepted entries after filtering hidden and symlinked names", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-inspector-bound-"));
  await fs.mkdir(path.join(root, "00-directory"));
  await fs.mkdir(path.join(root, ".conduit"));
  for (let index = 0; index < 500; index += 1) {
    await fs.writeFile(path.join(root, `file-${String(index).padStart(3, "0")}`), "content\n");
  }
  await fs.writeFile(path.join(root, "zzz-late"), "content\n");
  await fs.symlink(path.join(root, "file-000"), path.join(root, "symlinked"));

  const listing = await listWorkspaceDirectory(root);
  assert.equal(listing.truncated, true);
  assert.equal(listing.entries.length, 500);
  assert.equal(listing.entries[0].name, "00-directory");
  assert.deepEqual([...listing.entries].sort((left, right) => left.type === right.type ? left.name.localeCompare(right.name) : left.type === "directory" ? -1 : 1), listing.entries);
  assert.equal(listing.entries.some((entry) => entry.name === ".conduit"), false);
  assert.equal(listing.entries.some((entry) => entry.name === "symlinked"), false);
});

test("workspace version reports one shared change signal and ignores Conduit internals", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-workspace-version-"));
  t.after(() => closeWorkspaceVersionWatch(root));
  await fs.mkdir(path.join(root, ".conduit"));
  await fs.writeFile(path.join(root, "notes.txt"), "before\n");
  const first = await readWorkspaceVersion(root, { paths: ["", "notes.txt"] });
  assert.equal(first.changedPaths, null);
  await fs.writeFile(path.join(root, ".conduit", "state.json"), "ignored\n");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const ignored = await readWorkspaceVersion(root, { paths: ["", "notes.txt"] });
  assert.equal(ignored.version, first.version);
  await fs.writeFile(path.join(root, "notes.txt"), "after and larger\n");
  let changed = ignored;
  for (let attempt = 0; attempt < 20 && changed.version === ignored.version; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    changed = await readWorkspaceVersion(root, { paths: ["", "notes.txt"] });
  }
  assert.ok(changed.version > ignored.version);
  assert.ok(changed.changedPaths?.includes("notes.txt"));
});

test("workspace version falls back to visible-path mtime checks", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-workspace-version-fallback-"));
  t.after(() => closeWorkspaceVersionWatch(root));
  await fs.writeFile(path.join(root, "notes.txt"), "before\n");
  const unavailableWatch = () => { throw new Error("Recursive watch is unavailable"); };
  const first = await readWorkspaceVersion(root, { paths: ["notes.txt"], watchImpl: unavailableWatch });
  await fs.writeFile(path.join(root, "notes.txt"), "after and larger\n");
  const changed = await readWorkspaceVersion(root, { paths: ["notes.txt"], watchImpl: unavailableWatch });
  assert.ok(changed.version > first.version);
  assert.ok(changed.changedPaths?.includes("notes.txt"));
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

test("workspace folders can be created, moved, renamed, and deleted within the root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-inspector-folders-"));
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src", "main.js"), "content\n");

  assert.deepEqual(await createWorkspaceDirectory(root, "archive"), { path: "archive" });
  await moveWorkspaceEntry(root, "src/main.js", "archive/main.js");
  assert.equal(await fs.readFile(path.join(root, "archive", "main.js"), "utf8"), "content\n");
  await moveWorkspaceEntry(root, "archive", "saved");
  assert.equal(await fs.readFile(path.join(root, "saved", "main.js"), "utf8"), "content\n");

  await assert.rejects(createWorkspaceDirectory(root, "saved"), { code: "workspace_entry_exists" });
  await assert.rejects(moveWorkspaceEntry(root, "saved", "saved/nested"), { code: "invalid_workspace_move" });
  await assert.rejects(deleteWorkspaceDirectory(root, ""), { code: "invalid_workspace_path" });
  await deleteWorkspaceDirectory(root, "saved");
  await assert.rejects(fs.access(path.join(root, "saved")), { code: "ENOENT" });
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
  let result = await readWorkspaceDiff(root, { includeHistory: true });
  assert.equal(result.repository, true);
  assert.ok(result.branch);
  assert.equal(result.files.length, 0);
  assert.equal(result.commits[0].subject, "fixture");
  assert.equal(result.refs.some((ref) => ref.kind === "local" && ref.hash === result.commits[0].hash), true);
  await fs.writeFile(path.join(root, "tracked.txt"), "one\ntwo\n");
  result = await readWorkspaceDiff(root, { includePatch: true });
  assert.equal(result.files[0].status, " M");
  assert.match(result.diff, /Working tree/);
  await run("git", ["add", "tracked.txt"], { cwd: root });
  result = await readWorkspaceDiff(root, { includePatch: true });
  assert.equal(result.files[0].status, "M ");
  assert.match(result.diff, /Staged/);
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

test("workspace commit inspection returns one bounded historical patch", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-git-commit-"));
  await run("git", ["init", "-q"], { cwd: root });
  await run("git", ["config", "user.email", "test@conduit.local"], { cwd: root });
  await run("git", ["config", "user.name", "Conduit Test"], { cwd: root });
  await fs.writeFile(path.join(root, "tracked.txt"), "one\n");
  await run("git", ["add", "tracked.txt"], { cwd: root });
  await run("git", ["commit", "-qm", "Inspect this commit"], { cwd: root });
  const { commits } = await readWorkspaceDiff(root, { includeHistory: true });
  const detail = await readWorkspaceCommit(root, commits[0].hash);
  assert.equal(detail.hash, commits[0].hash);
  assert.match(detail.content, /Inspect this commit/);
  assert.match(detail.content, /tracked\.txt/);
  await assert.rejects(readWorkspaceCommit(root, "HEAD"), { code: "invalid_workspace_commit" });
});

test("workspace Git actions fetch and fast-forward the current branch", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-git-sync-"));
  const remote = path.join(parent, "remote.git");
  const local = path.join(parent, "local");
  const peer = path.join(parent, "peer");
  await run("git", ["init", "--bare", "-q", remote]);
  await run("git", ["clone", "-q", remote, local]);
  await run("git", ["config", "user.email", "test@conduit.local"], { cwd: local });
  await run("git", ["config", "user.name", "Conduit Test"], { cwd: local });
  await fs.writeFile(path.join(local, "tracked.txt"), "one\n");
  await run("git", ["add", "tracked.txt"], { cwd: local });
  await run("git", ["commit", "-qm", "fixture"], { cwd: local });
  await run("git", ["push", "-qu", "origin", "HEAD"], { cwd: local });
  await run("git", ["clone", "-q", remote, peer]);
  await run("git", ["config", "user.email", "peer@conduit.local"], { cwd: peer });
  await run("git", ["config", "user.name", "Conduit Peer"], { cwd: peer });
  await fs.writeFile(path.join(peer, "tracked.txt"), "two\n");
  await run("git", ["commit", "-qam", "remote change"], { cwd: peer });
  await run("git", ["push", "-q"], { cwd: peer });

  await runWorkspaceGitAction(local, { action: "fetch" });
  await runWorkspaceGitAction(local, { action: "pull" });
  assert.equal(await fs.readFile(path.join(local, "tracked.txt"), "utf8"), "two\n");
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
  const first = readWorkspaceDiff(root, { includeHistory: false, runGit });
  const second = readWorkspaceDiff(root, { includeHistory: false, runGit });
  await new Promise((resolve) => setTimeout(resolve, 10));
  releaseOverview();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(left.repository, true);
  assert.deepEqual(right.files, left.files);
  assert.equal(calls.filter((call) => call.includes("--is-inside-work-tree")).length, 1);
  assert.equal(calls.filter((call) => call.startsWith("diff ")).length, 0);

  const patch = await readWorkspaceDiff(root, { includePatch: true, includeHistory: false, reuse: true, runGit });
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

test("bounded Git transfers each released slot without exceeding its process cap", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-git-slots-"));
  let active = 0;
  let peak = 0;
  let started = 0;
  let fifthStart;
  const fifthStarted = new Promise((resolve) => { fifthStart = resolve; });
  const options = {
    timeoutMs: 5_000,
    onSpawn: (child) => {
      active += 1;
      peak = Math.max(peak, active);
      if (++started === 5) fifthStart();
      child.once("close", () => { active -= 1; });
    },
  };
  const args = ["-c", "alias.wait=!sleep 0.08", "wait"];
  const queued = Array.from({ length: 8 }, () => runBoundedGit(root, args, options));
  await fifthStarted;
  const later = Array.from({ length: 12 }, () => runBoundedGit(root, args, options));
  await Promise.all([...queued, ...later]);
  assert.equal(peak, MAX_CONCURRENT_GIT_PROCESSES);
  assert.equal(active, 0);
});
