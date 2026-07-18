import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertAllowedPath,
  isPathInside,
  parseAllowlist,
  resolveExistingDirectory,
} from "../src/workspace-paths.js";

test("parseAllowlist expands home and de-duplicates", () => {
  const home = "/home/user";
  assert.deepEqual(
    parseAllowlist("~/code:/home/user/code,/tmp/work", { home }),
    ["/home/user/code", "/tmp/work"],
  );
});

test("assertAllowedPath rejects paths outside the allowlist", () => {
  assert.equal(assertAllowedPath("/home/user/proj", ["/home/user"]), "/home/user/proj");
  assert.throws(() => assertAllowedPath("/etc/passwd", ["/home/user"]), { code: "path_not_allowed" });
  assert.equal(isPathInside("/home/user/a", "/home/user"), true);
  assert.equal(isPathInside("/home/user", "/home/user/a"), false);
});

test("resolveExistingDirectory requires a real directory inside the allowlist", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-ws-path-"));
  const dir = path.join(root, "repo");
  await fs.mkdir(dir);
  await fs.writeFile(path.join(root, "file.txt"), "x");
  assert.equal(await resolveExistingDirectory(dir, [root]), await fs.realpath(dir));
  await assert.rejects(resolveExistingDirectory(path.join(root, "missing"), [root]), { code: "path_not_found" });
  await assert.rejects(resolveExistingDirectory(path.join(root, "file.txt"), [root]), { code: "path_not_directory" });
  await assert.rejects(resolveExistingDirectory("/etc", [root]), { code: "path_not_allowed" });
  await fs.rm(root, { recursive: true, force: true });
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
