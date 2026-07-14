#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPiEnvironment, buildPiResourceArgs, loadPiProfile } from "./pi-runtime.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stateDir = path.resolve(process.env.CONDUIT_STATE_DIR || path.join(repositoryRoot, "app/state"));
const agentDir = path.resolve(process.env.CONDUIT_PI_AGENT_DIR || path.join(stateDir, "pi-agent"));
const profileFile = path.resolve(process.env.CONDUIT_PI_PROFILE || path.join(repositoryRoot, ".pi/experiences/chat/profile.json"));
const profile = loadPiProfile(profileFile);

await fs.mkdir(agentDir, { recursive: true });
const child = spawn(process.env.PI_COMMAND || "pi", [...buildPiResourceArgs(profile), ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: buildPiEnvironment(agentDir),
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.once("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = signal ? 1 : code ?? 1;
});
