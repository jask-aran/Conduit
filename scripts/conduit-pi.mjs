#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPiEnvironment,
  buildPiResourceArgs,
  loadPiModelPatterns,
  loadPiTemplate,
} from "./pi-runtime.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentDir = path.resolve(process.env.CONDUIT_PI_AGENT_DIR || path.join(repositoryRoot, "data/pi"));
const templateFile = path.resolve(process.env.CONDUIT_PI_TEMPLATE || path.join(repositoryRoot, "templates/chat/template.json"));
const template = loadPiTemplate(templateFile);
const bundledPi = path.join(repositoryRoot, "conduit-web/node_modules/@earendil-works/pi-coding-agent/dist/cli.js");

await fs.mkdir(agentDir, { recursive: true });
const models = loadPiModelPatterns(agentDir, template.models);
const child = spawn(process.env.CONDUIT_PI_COMMAND || process.env.PI_COMMAND || bundledPi, [
  ...buildPiResourceArgs({ ...template, models }),
  ...process.argv.slice(2),
], {
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
