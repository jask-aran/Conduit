import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateNativeProjectResources } from "../src/native-resource-validation.js";

async function temporaryWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-native-resources-"));
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace);
  return { root, workspace };
}

test("native resource validation reads metadata without opening file contents", async (t) => {
  const { root, workspace } = await temporaryWorkspace();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const theme = path.join(workspace, ".pi", "themes", "large.json");
  await fs.mkdir(path.dirname(theme), { recursive: true });
  await fs.writeFile(theme, "content that preflight must not read");
  const calls = { lstat: 0, readdir: 0, readFile: 0 };
  const fileSystem = {
    async lstat(target) {
      calls.lstat += 1;
      return fs.lstat(target);
    },
    async readdir(target, options) {
      calls.readdir += 1;
      return fs.readdir(target, options);
    },
    async readFile() {
      calls.readFile += 1;
      throw new Error("resource contents were read");
    },
  };

  const result = await validateNativeProjectResources(workspace, { fileSystem });

  assert.equal(result.entryCount, 3);
  assert.equal(result.totalBytes, Buffer.byteLength("content that preflight must not read"));
  assert.ok(calls.lstat >= result.entryCount);
  assert.equal(calls.readdir, 2);
  assert.equal(calls.readFile, 0);
});

test("native resource validation rejects symlinked resource ancestors", async (t) => {
  const { root, workspace } = await temporaryWorkspace();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const external = path.join(root, "external-agents");
  await fs.mkdir(path.join(external, "skills"), { recursive: true });
  await fs.symlink(external, path.join(workspace, ".agents"));

  await assert.rejects(
    validateNativeProjectResources(workspace),
    (error) => error.code === "native_resource_symlink",
  );
});

test("native resource validation enforces entry and aggregate-size limits from metadata", async (t) => {
  const { root, workspace } = await temporaryWorkspace();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const themes = path.join(workspace, ".pi", "themes");
  await fs.mkdir(themes, { recursive: true });
  await fs.writeFile(path.join(themes, "one"), "1234");
  await fs.writeFile(path.join(themes, "two"), "5678");

  await assert.rejects(
    validateNativeProjectResources(workspace, { maxEntries: 3 }),
    (error) => error.code === "native_resource_limit" && error.message.includes("Too many"),
  );
  await assert.rejects(
    validateNativeProjectResources(workspace, { maxBytes: 7 }),
    (error) => error.code === "native_resource_limit" && error.message.includes("too large"),
  );
});
