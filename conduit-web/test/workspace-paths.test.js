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
  assert.equal(await resolveExistingDirectory(dir, [root]), dir);
  await assert.rejects(resolveExistingDirectory(path.join(root, "missing"), [root]), { code: "path_not_found" });
  await assert.rejects(resolveExistingDirectory(path.join(root, "file.txt"), [root]), { code: "path_not_directory" });
  await assert.rejects(resolveExistingDirectory("/etc", [root]), { code: "path_not_allowed" });
  await fs.rm(root, { recursive: true, force: true });
});
