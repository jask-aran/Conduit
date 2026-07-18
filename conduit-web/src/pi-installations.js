import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "@earendil-works/pi-coding-agent";

const bundledCli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../node_modules/@earendil-works/pi-coding-agent/dist/cli.js");

function executableVersion(command, args = []) {
  const result = spawnSync(command, [...args, "--version"], {
    encoding: "utf8",
    env: process.env,
    timeout: 5000,
  });
  if (result.error || result.status !== 0) return null;
  const match = String(result.stdout || result.stderr || "").match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/);
  return match?.[0] || null;
}

function resolveHostCommand(override = "") {
  const requested = String(override || "").trim();
  if (requested && path.isAbsolute(requested)) {
    const resolved = path.resolve(requested);
    return fs.existsSync(resolved) ? resolved : null;
  }
  if (requested && requested !== "pi") return null;
  const shell = process.env.SHELL || "/bin/sh";
  const result = spawnSync(shell, ["-lc", "command -v pi"], {
    encoding: "utf8",
    env: process.env,
    timeout: 5000,
  });
  const detected = String(result.stdout || "").trim().split("\n")[0];
  if (result.status !== 0 || !path.isAbsolute(detected)) return null;
  try { return fs.realpathSync(detected); }
  catch { return null; }
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", () => { clearTimeout(timer); resolve({ status: -1, stdout, stderr }); });
    child.on("close", (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
}

async function resolveHostCommandAsync(override = "") {
  const requested = String(override || "").trim();
  if (requested && path.isAbsolute(requested)) return fs.existsSync(requested) ? path.resolve(requested) : null;
  if (requested && requested !== "pi") return null;
  const result = await run(process.env.SHELL || "/bin/sh", ["-lc", "command -v pi"]);
  const detected = result.stdout.trim().split("\n")[0];
  if (result.status !== 0 || !path.isAbsolute(detected)) return null;
  try { return fs.realpathSync(detected); }
  catch { return null; }
}

export class PiInstallationRegistry {
  constructor({ conduitAgentDir, conduitCommand = "", nativeCommand = "" }) {
    this.conduitAgentDir = path.resolve(conduitAgentDir);
    this.conduitCommand = conduitCommand ? resolveHostCommand(conduitCommand) : bundledCli;
    this.nativeCommandOverride = nativeCommand;
    this.installations = new Map();
    this.detect();
  }

  detect() {
    const checkedAt = new Date().toISOString();
    this.installations.set("conduit-pinned", {
      id: "conduit-pinned",
      label: "Conduit",
      source: "bundled",
      command: this.conduitCommand,
      commandArgs: [],
      agentDir: this.conduitAgentDir,
      version: VERSION,
      available: fs.existsSync(this.conduitCommand),
      checkedAt,
      error: fs.existsSync(this.conduitCommand) ? null : "Bundled Pi executable is missing",
    });

    const command = resolveHostCommand(this.nativeCommandOverride);
    const version = command ? executableVersion(command) : null;
    this.installations.set("host-pi", {
      id: "host-pi",
      label: "Native Pi",
      source: "host",
      command,
      commandArgs: [],
      agentDir: path.join(os.homedir(), ".pi", "agent"),
      version,
      available: Boolean(command && version),
      checkedAt,
      error: command ? (version ? null : "Host Pi did not report a version") : "Host Pi was not found",
    });
    return this.list();
  }

  async detectHost() {
    const checkedAt = new Date().toISOString();
    const command = await resolveHostCommandAsync(this.nativeCommandOverride);
    const result = command ? await run(command, ["--version"]) : null;
    const match = String(result?.stdout || result?.stderr || "").match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/);
    const version = result?.status === 0 ? match?.[0] || null : null;
    const installation = {
      id: "host-pi",
      label: "Native Pi",
      source: "host",
      command,
      commandArgs: [],
      agentDir: path.join(os.homedir(), ".pi", "agent"),
      version,
      available: Boolean(command && version),
      checkedAt,
      error: command ? (version ? null : "Host Pi did not report a version") : "Host Pi was not found",
    };
    this.installations.set("host-pi", installation);
    return installation;
  }

  get(id) {
    return this.installations.get(id) || null;
  }

  list() {
    return [...this.installations.values()];
  }

  publicList() {
    return this.list().map(({ command: _command, commandArgs: _args, agentDir: _agentDir, ...installation }) => installation);
  }
}
