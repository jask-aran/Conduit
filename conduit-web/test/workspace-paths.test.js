import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertSafeWorkspaceRoot,
  resolveExistingDirectory,
  resolveNewWorkspaceDirectory,
} from "../src/workspace-paths.js";

test("dangerous workspace roots fail closed", () => {
  assert.throws(() => assertSafeWorkspaceRoot("/"), { code: "dangerous_workspace_root", reason: "system_root" });
  assert.throws(() => assertSafeWorkspaceRoot("/home/user", { home: "/home/user" }), {
    code: "dangerous_workspace_root",
    reason: "home_root",
  });
  assert.throws(() => assertSafeWorkspaceRoot("/srv/conduit/data/chat", { dataRoot: "/srv/conduit/data" }), {
    code: "dangerous_workspace_root",
    reason: "conduit_data",
  });
  assert.equal(assertSafeWorkspaceRoot("/home/user/code", { home: "/home/user" }), "/home/user/code");
});

test("resolveExistingDirectory rejects intermediate symlink escapes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-ws-escape-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-ws-outside-"));
  const secret = path.join(outside, "secret");
  await fs.mkdir(secret);
  await fs.writeFile(path.join(secret, "x"), "nope");
  const shortcut = path.join(root, "shortcut");
  await fs.symlink(outside, shortcut);
  // Textual path looks allow-listed; realpath lands outside.
  await assert.rejects(resolveExistingDirectory(path.join(shortcut, "secret"), [root]), {
    code: "path_not_allowed",
  });
  // Leaf symlink to outside is also rejected after realpath.
  const leaf = path.join(root, "leaf-link");
  await fs.symlink(secret, leaf);
  await assert.rejects(resolveExistingDirectory(leaf, [root]), { code: "path_not_allowed" });
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

test("resolveNewWorkspaceDirectory accepts one safe missing child and rejects unsafe targets", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-ws-create-"));
  const parent = path.join(root, "workspaces");
  await fs.mkdir(parent);
  assert.equal(await resolveNewWorkspaceDirectory(root, "from-home", [root], { home: root }), path.join(root, "from-home"));
  assert.equal(await resolveNewWorkspaceDirectory(parent, "new-app", [root]), path.join(parent, "new-app"));
  await assert.rejects(resolveNewWorkspaceDirectory(parent, "nested/app", [root]), { code: "workspace_directory_invalid" });
  await assert.rejects(resolveNewWorkspaceDirectory(parent, ".conduit", [root]), { code: "workspace_directory_invalid" });
  await fs.mkdir(path.join(parent, "existing"));
  await assert.rejects(resolveNewWorkspaceDirectory(parent, "existing", [root]), { code: "workspace_path_exists" });
  await fs.symlink(path.join(root, "outside"), path.join(parent, "linked"));
  await assert.rejects(resolveNewWorkspaceDirectory(parent, "linked", [root]), { code: "workspace_path_symlink" });
  await fs.mkdir(path.join(root, "data"));
  await assert.rejects(resolveNewWorkspaceDirectory(path.join(root, "data"), "blocked", [root], { dataRoot: path.join(root, "data") }), { code: "dangerous_workspace_root" });
  await fs.rm(root, { recursive: true, force: true });
});
