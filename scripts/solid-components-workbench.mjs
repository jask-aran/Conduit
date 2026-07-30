#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  hashDirectory,
  localTypeScriptConfig,
  resolveSolidComponents,
  SOLID_COMPONENTS_PACKAGE,
} from "../conduit-web/scripts/solid-components-mode.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = path.join(root, "conduit-web");
const managedServer = path.join(root, ".devcontainer", "start-conduit.sh");
const stateRoot = path.resolve(
  process.env.CONDUIT_STATE_DIR || path.join(os.homedir(), ".conduit"),
);
const stateFile = path.join(stateRoot, "solid-components-workbench.json");
const previewRoot = path.join(stateRoot, "solid-components-preview");
const previewMarker = path.join(webRoot, "dist", ".solid-components-preview.json");

function run(program, args, options = {}) {
  const result = spawnSync(program, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? (result.stderr || result.stdout).trim() : "";
    throw new Error(
      `${program} ${args.join(" ")} failed with exit code ${result.status}${detail ? `: ${detail}` : ""}`,
    );
  }
  return options.capture ? result.stdout.trim() : "";
}

function runManaged(command, mode) {
  const env = { CONDUIT_SOLID_COMPONENTS_MANAGED: "1" };
  if (mode) {
    env.CONDUIT_SOLID_COMPONENTS_MODE = mode.mode;
    env.CONDUIT_SOLID_COMPONENTS_ROOT = mode.packageRoot;
  }
  run("bash", [managedServer, command], { env });
}

async function readJson(file) {
  return JSON.parse(await fsp.readFile(file, "utf8"));
}

async function readState() {
  try {
    return await readJson(stateFile);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeState(state) {
  await fsp.mkdir(stateRoot, { recursive: true });
  const temporary = `${stateFile}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
  await fsp.rename(temporary, stateFile);
}

function componentRoot(argument) {
  return path.resolve(
    argument
      || process.env.CONDUIT_SOLID_COMPONENTS_DIR
      || path.resolve(root, "..", "solid-components"),
  );
}

function gitOutput(repository, args) {
  return run("git", args, { cwd: repository, capture: true });
}

function assertClean(repository, label) {
  const status = gitOutput(repository, ["status", "--porcelain"]);
  if (status) throw new Error(`${label} must be clean before creating or promoting a candidate.`);
}

async function hashFile(file) {
  return createHash("sha256").update(await fsp.readFile(file)).digest("hex");
}

async function removePreviewFiles() {
  const relative = path.relative(stateRoot, previewRoot);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to remove preview path outside ${stateRoot}.`);
  }
  await fsp.rm(previewRoot, { recursive: true, force: true });
  await fsp.rm(previewMarker, { force: true });
}

async function typecheckAgainst(resolution) {
  const configRoot = path.join(webRoot, "node_modules", ".cache", "conduit-components");
  const configPath = path.join(configRoot, "tsconfig.json");
  await fsp.mkdir(configRoot, { recursive: true });
  await fsp.writeFile(
    configPath,
    `${JSON.stringify(localTypeScriptConfig({ conduitWebRoot: webRoot, resolution }), null, 2)}\n`,
  );
  run(path.join(webRoot, "node_modules", ".bin", "tsc"), ["--noEmit", "-p", configPath]);
}

async function status() {
  const state = await readState();
  if (!state) {
    console.log("solid-components mode: registry");
    console.log(`version: ${(await readJson(path.join(webRoot, "package.json"))).dependencies[SOLID_COMPONENTS_PACKAGE]}`);
    return;
  }
  console.log(`solid-components mode: ${state.mode}`);
  console.log(`source: ${state.sourceRoot}`);
  console.log(`candidate commit: ${state.candidateCommit ?? "unsealed"}`);
  console.log(`payload sha256: ${state.distHash ?? "unsealed"}`);
  const url = state.mode === "source" && state.surface !== "serve"
    ? "http://127.0.0.1:5173"
    : "http://127.0.0.1:4310";
  console.log(`Conduit URL: ${url}`);
}

async function dev(repository) {
  const resolution = resolveSolidComponents(repository, "source");
  const candidateCommit = gitOutput(resolution.root, ["rev-parse", "HEAD"]);
  const dirty = Boolean(gitOutput(resolution.root, ["status", "--porcelain"]));
  await writeState({
    mode: "source",
    sourceRoot: resolution.root,
    packageRoot: resolution.root,
    candidateCommit,
    dirty,
    startedAt: new Date().toISOString(),
  });
  try {
    runManaged("dev", { mode: "source", packageRoot: resolution.root });
  } catch (error) {
    await fsp.rm(stateFile, { force: true });
    throw error;
  }
}

async function serve(repository) {
  const resolution = resolveSolidComponents(repository, "source");
  const candidateCommit = gitOutput(resolution.root, ["rev-parse", "HEAD"]);
  const state = {
    mode: "source",
    surface: "serve",
    sourceRoot: resolution.root,
    packageRoot: resolution.root,
    candidateCommit,
    dirty: Boolean(gitOutput(resolution.root, ["status", "--porcelain"])),
    startedAt: new Date().toISOString(),
  };
  await writeState(state);
  const mode = { mode: "source", packageRoot: resolution.root };
  try {
    runManaged("build", mode);
    await fsp.writeFile(previewMarker, `${JSON.stringify(state, null, 2)}\n`);
    runManaged("stop", mode);
    runManaged("start", mode);
  } catch (error) {
    await fsp.rm(stateFile, { force: true });
    throw error;
  }
  console.log(`Patched source ${candidateCommit} is running at http://127.0.0.1:4310.`);
}

async function preview(repository) {
  const source = resolveSolidComponents(repository, "source");
  assertClean(source.root, "solid-components");
  const candidateCommit = gitOutput(source.root, ["rev-parse", "HEAD"]);
  const packageLockHash = await hashFile(path.join(source.root, "package-lock.json"));

  run("npm", ["run", "verify"], { cwd: source.root });
  await removePreviewFiles();
  await fsp.mkdir(previewRoot, { recursive: true });
  const packOutput = run(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", previewRoot],
    { cwd: source.root, capture: true },
  );
  const packResult = JSON.parse(packOutput);
  if (!Array.isArray(packResult) || packResult.length !== 1 || !packResult[0].filename) {
    throw new Error("npm pack did not return one package filename.");
  }
  const tarball = path.join(previewRoot, packResult[0].filename);
  run("tar", ["-xzf", tarball, "-C", previewRoot]);
  const packageRoot = path.join(previewRoot, "package");
  const resolution = resolveSolidComponents(packageRoot, "preview");
  const distHash = await hashDirectory(path.join(packageRoot, "dist"));

  await typecheckAgainst(resolution);
  const mode = { mode: "preview", packageRoot };
  runManaged("build", mode);

  const approval = {
    mode: "preview",
    sourceRoot: source.root,
    packageRoot,
    candidateCommit,
    packageVersion: resolution.packageJson.version,
    packageLockHash,
    distHash,
    tarball,
    verifiedAt: new Date().toISOString(),
  };
  await writeState(approval);
  await fsp.writeFile(previewMarker, `${JSON.stringify(approval, null, 2)}\n`);
  runManaged("stop", mode);
  runManaged("start", mode);
  console.log(`Candidate ${candidateCommit} is ready for approval at http://127.0.0.1:4310.`);
  console.log(`Packed dist sha256: ${distHash}`);
}

async function registry() {
  const state = await readState();
  runManaged("stop", state ? { mode: state.mode, packageRoot: state.packageRoot } : null);
  await fsp.rm(stateFile, { force: true });
  await removePreviewFiles();
  runManaged("build", null);
  runManaged("start", null);
}

async function waitForPublish(releaseCommit, version) {
  let runId = null;
  for (let attempt = 0; attempt < 60 && !runId; attempt += 1) {
    const output = run(
      "gh",
      [
        "run", "list",
        "--repo", "jask-aran/solid-components",
        "--workflow", "publish.yml",
        "--commit", releaseCommit,
        "--json", "databaseId",
        "--limit", "1",
      ],
      { capture: true },
    );
    const runs = JSON.parse(output || "[]");
    runId = runs[0]?.databaseId ?? null;
    if (!runId) await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (!runId) throw new Error(`No publish workflow appeared for ${releaseCommit}.`);
  run("gh", ["run", "watch", String(runId), "--repo", "jask-aran/solid-components", "--exit-status"]);

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const published = run(
        "npm",
        ["view", `${SOLID_COMPONENTS_PACKAGE}@${version}`, "version"],
        { capture: true },
      );
      if (published === version) return;
    } catch {
      // Registry propagation is expected to lag the successful workflow briefly.
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`${SOLID_COMPONENTS_PACKAGE}@${version} did not become visible on npm.`);
}

async function promote(bump, dryRun) {
  if (!["patch", "minor", "major"].includes(bump)) {
    throw new Error("promote requires an explicit patch, minor, or major version bump.");
  }
  const approval = await readState();
  if (!approval || approval.mode !== "preview") {
    throw new Error("No approved preview candidate exists. Run preview and obtain approval first.");
  }

  const source = resolveSolidComponents(approval.sourceRoot, "source");
  assertClean(source.root, "solid-components");
  const head = gitOutput(source.root, ["rev-parse", "HEAD"]);
  if (head !== approval.candidateCommit) {
    throw new Error(`Candidate HEAD changed after preview: expected ${approval.candidateCommit}, found ${head}.`);
  }
  if (await hashFile(path.join(source.root, "package-lock.json")) !== approval.packageLockHash) {
    throw new Error("solid-components package-lock.json changed after preview.");
  }
  if (await hashDirectory(path.join(source.root, "dist")) !== approval.distHash) {
    throw new Error("solid-components dist changed after preview.");
  }
  if (gitOutput(root, ["status", "--porcelain", "--", "conduit-web/package.json", "conduit-web/package-lock.json"])) {
    throw new Error("Conduit package.json and package-lock.json must be clean before promotion.");
  }

  if (dryRun) {
    console.log(`Promotion preflight passed for ${head} (${approval.distHash}).`);
    console.log(`Would create one ${bump} release, publish it, and adopt the exact npm version in Conduit.`);
    return;
  }

  const registryVersion = run("npm", ["view", SOLID_COMPONENTS_PACKAGE, "version"], { capture: true });
  if (registryVersion !== source.packageJson.version) {
    throw new Error(
      `Local version ${source.packageJson.version} does not match npm latest ${registryVersion}; update before promoting.`,
    );
  }

  run("npm", ["version", bump, "--no-git-tag-version"], { cwd: source.root });
  const releasePackage = await readJson(path.join(source.root, "package.json"));
  const version = releasePackage.version;
  run("npm", ["run", "build"], { cwd: source.root });
  if (await hashDirectory(path.join(source.root, "dist")) !== approval.distHash) {
    throw new Error("Release metadata changed the approved distributable payload; refusing to tag.");
  }
  run("npm", ["run", "verify:package"], { cwd: source.root });

  const changed = gitOutput(source.root, ["status", "--porcelain"])
    .split("\n")
    .filter(Boolean);
  if (
    changed.length !== 2
    || !changed.every((line) => / package(?:-lock)?\.json$/.test(line))
  ) {
    throw new Error(`Unexpected release changes:\n${changed.join("\n")}`);
  }

  run("git", ["add", "package.json", "package-lock.json"], { cwd: source.root });
  run(
    "git",
    [
      "commit",
      "-m", `Release v${version}`,
      "-m", `Promote the Conduit-approved component payload from ${approval.candidateCommit}.\n\nVerified with npm run verify; dist sha256 ${approval.distHash}.`,
    ],
    { cwd: source.root },
  );
  run("git", ["tag", "-a", `v${version}`, "-m", `Release v${version}`], { cwd: source.root });
  const releaseCommit = gitOutput(source.root, ["rev-parse", "HEAD"]);
  run("git", ["push", "origin", "main", "--follow-tags"], { cwd: source.root });
  await waitForPublish(releaseCommit, version);

  run("npm", ["install", "--save-exact", `${SOLID_COMPONENTS_PACKAGE}@${version}`], { cwd: webRoot });
  await registry();
  console.log(`${SOLID_COMPONENTS_PACKAGE}@${version} is installed and running at http://127.0.0.1:4310.`);
  console.log("Conduit package.json and package-lock.json remain uncommitted for review and full verification.");
}

function usage() {
  console.log(`Usage: bash .devcontainer/solid-components.sh <command>

Commands:
  dev [repo]                         Run Conduit with source HMR on port 5173.
  serve [repo]                       Build current source and run it on port 4310.
  preview [repo]                     Pack and run a clean candidate on port 4310.
  promote <patch|minor|major> [--dry-run]
                                     Publish the approved candidate and adopt it.
  registry                           Return to Conduit's locked npm release.
  status                             Report the active component mode.

The repository defaults to ../solid-components. Override it with
CONDUIT_SOLID_COMPONENTS_DIR or the optional repo argument.`);
}

async function main() {
  const [command = "status", ...args] = process.argv.slice(2);
  switch (command) {
    case "dev":
      await dev(componentRoot(args[0]));
      break;
    case "serve":
      await serve(componentRoot(args[0]));
      break;
    case "preview":
      await preview(componentRoot(args[0]));
      break;
    case "promote": {
      const dryRun = args.includes("--dry-run");
      const bump = args.find((argument) => !argument.startsWith("--"));
      await promote(bump, dryRun);
      break;
    }
    case "registry":
      await registry();
      break;
    case "status":
      await status();
      break;
    case "help":
    case "-h":
    case "--help":
      usage();
      break;
    default:
      usage();
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
