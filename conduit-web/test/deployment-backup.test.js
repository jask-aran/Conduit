import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "../..");

async function run(file, args, options = {}) {
  try {
    return await execFileAsync(file, args, { ...options, encoding: "utf8" });
  } catch (error) {
    return { stdout: error.stdout || "", stderr: error.stderr || "", code: error.code };
  }
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-backup-test-"));
  const bin = path.join(root, "bin");
  await fs.mkdir(bin);
  await fs.mkdir(path.join(root, "scripts"));
  await fs.copyFile(path.join(repositoryRoot, "scripts", "backup.sh"), path.join(root, "scripts", "backup.sh"));
  await fs.copyFile(path.join(repositoryRoot, "scripts", "restore.sh"), path.join(root, "scripts", "restore.sh"));
  await fs.chmod(path.join(root, "scripts", "backup.sh"), 0o755);
  await fs.chmod(path.join(root, "scripts", "restore.sh"), 0o755);
  await fs.writeFile(path.join(root, "compose.yaml"), "services: {}\n");
  await fs.writeFile(path.join(root, ".env"), "CONDUIT_DATA_DIR=./data\nCONDUIT_WORKSPACES_DIR=./workspaces\n");
  await fs.mkdir(path.join(root, "data"));
  await fs.mkdir(path.join(root, "workspaces"));
  await fs.writeFile(path.join(root, "data", "state.json"), "{\"fixture\":true}\n");
  await fs.writeFile(path.join(root, "workspaces", "workspace.txt"), "workspace fixture\n");
  await fs.writeFile(path.join(bin, "docker"), `#!/usr/bin/env bash
if [[ "$1" == "compose" && "$2" == "version" ]]; then exit 0; fi
if [[ "$1" == "compose" && " $* " == *" ps -q "* ]]; then printf '%s' "\${FAKE_DOCKER_PS:-}"; exit 0; fi
exit 0
`);
  await fs.chmod(path.join(bin, "docker"), 0o755);
  return { root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } };
}

test("backup refuses a running source container and emits a verifiable cold archive", async (t) => {
  const { root, env } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const hot = await run(path.join(root, "scripts", "backup.sh"), [], {
    cwd: root, env: { ...env, FAKE_DOCKER_PS: "running-container" },
  });
  assert.equal(hot.code, 1);
  assert.match(hot.stderr, /Refusing a hot backup/);

  const backupDirectory = path.join(root, "backups");
  const cold = await run(path.join(root, "scripts", "backup.sh"), [backupDirectory], { cwd: root, env });
  assert.equal(cold.code, undefined);
  const archive = (await fs.readdir(backupDirectory)).find((name) => name.endsWith(".tar.gz"));
  assert.ok(archive);
  const manifest = await fs.readFile(path.join(backupDirectory, `${archive}.manifest`), "utf8");
  assert.match(manifest, /^format=conduit-backup-v1$/m);
  assert.match(manifest, /^archive_sha256=[a-f0-9]{64}$/m);
  assert.match(manifest, /^file=/m);

  const target = path.join(root, "target");
  await fs.mkdir(path.join(target, "scripts"), { recursive: true });
  await fs.mkdir(path.join(target, "bin"));
  await fs.copyFile(path.join(root, "compose.yaml"), path.join(target, "compose.yaml"));
  await fs.copyFile(path.join(root, "scripts", "restore.sh"), path.join(target, "scripts", "restore.sh"));
  await fs.copyFile(path.join(root, "bin", "docker"), path.join(target, "bin", "docker"));
  await fs.chmod(path.join(target, "scripts", "restore.sh"), 0o755);
  await fs.chmod(path.join(target, "bin", "docker"), 0o755);
  const archivePath = path.join(backupDirectory, archive);
  const targetArchive = path.join(target, "backup.tar.gz");
  await fs.copyFile(archivePath, targetArchive);
  await fs.copyFile(`${archivePath}.manifest`, `${targetArchive}.manifest`);
  const restored = await run(path.join(target, "scripts", "restore.sh"), [targetArchive], {
    cwd: target, env: { ...env, PATH: `${path.join(target, "bin")}:${process.env.PATH}` },
  });
  assert.equal(restored.code, undefined);
  assert.equal(await fs.readFile(path.join(target, "data", "state.json"), "utf8"), "{\"fixture\":true}\n");
  assert.equal(await fs.readFile(path.join(target, "workspaces", "workspace.txt"), "utf8"), "workspace fixture\n");

  await fs.appendFile(path.join(backupDirectory, archive), "tampered");
  const restore = await run(path.join(root, "scripts", "restore.sh"), [path.join(backupDirectory, archive)], { cwd: root, env });
  assert.equal(restore.code, 1);
  assert.match(restore.stderr, /checksum does not match/);
});
