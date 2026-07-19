import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "@earendil-works/pi-coding-agent";

const bundledCli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
const REQUIRED_NATIVE_FLAGS = ["--mode", "--session", "--append-system-prompt", "--skill", "--approve", "--no-approve"];

function capabilitiesFromHelp(help, available = true) {
  return Object.fromEntries(REQUIRED_NATIVE_FLAGS.map((flag) => [flag.slice(2).replaceAll("-", "_"), Boolean(available && help.includes(flag))]));
}

function parseVersion(output) {
  return String(output || "").match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/)?.[0] || null;
}

function parseEnvironment(buffer, fallback = process.env) {
  if (!buffer) return { ...fallback };
  const environment = {};
  for (const entry of Buffer.from(buffer).toString("utf8").split("\0")) {
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    const key = entry.slice(0, separator).trimStart().split(/\s+/).at(-1);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) environment[key] = entry.slice(separator + 1);
  }
  return Object.keys(environment).length ? environment : { ...fallback };
}

function loginShellEnvironmentSync() {
  const result = spawnSync(process.env.SHELL || "/bin/sh", ["-lc", "env -0"], {
    env: process.env,
    encoding: null,
    timeout: 5000,
  });
  return result.status === 0 ? parseEnvironment(result.stdout) : { ...process.env };
}

function resolveCommandSync(override, environment) {
  const requested = String(override || "").trim();
  if (requested) {
    if (!path.isAbsolute(requested)) return null;
    return fs.existsSync(requested) ? path.resolve(requested) : null;
  }
  const result = spawnSync(environment.SHELL || process.env.SHELL || "/bin/sh", ["-lc", "command -v pi"], {
    encoding: "utf8",
    env: environment,
    timeout: 5000,
  });
  const detected = String(result.stdout || "").trim().split("\n").at(-1);
  if (result.status !== 0 || !path.isAbsolute(detected)) return null;
  try { return fs.realpathSync(detected); }
  catch { return null; }
}

function probeSync(command, environment) {
  if (!command) return { version: null, compatible: false, capabilities: capabilitiesFromHelp("", false) };
  const versionResult = spawnSync(command, ["--version"], { encoding: "utf8", env: environment, timeout: 5000 });
  const helpResult = spawnSync(command, ["--help"], { encoding: "utf8", env: environment, timeout: 5000 });
  const version = versionResult.status === 0 ? parseVersion(versionResult.stdout || versionResult.stderr) : null;
  const help = String(helpResult.stdout || helpResult.stderr || "");
  const capabilities = capabilitiesFromHelp(help, helpResult.status === 0);
  return { version, capabilities, compatible: Boolean(version && Object.values(capabilities).every(Boolean)) };
}

function run(command, args, environment, { encoding = "utf8" } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env: environment, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", () => { clearTimeout(timer); resolve({ status: -1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }); });
    child.on("close", (status) => { clearTimeout(timer); resolve({ status, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }); });
  }).then((result) => encoding === null ? result : ({
    ...result,
    stdout: result.stdout.toString(encoding),
    stderr: result.stderr.toString(encoding),
  }));
}

async function loginShellEnvironment() {
  const result = await run(process.env.SHELL || "/bin/sh", ["-lc", "env -0"], process.env, { encoding: null });
  return result.status === 0 ? parseEnvironment(result.stdout) : { ...process.env };
}

async function resolveCommand(override, environment) {
  const requested = String(override || "").trim();
  if (requested) {
    if (!path.isAbsolute(requested)) return null;
    return fs.existsSync(requested) ? path.resolve(requested) : null;
  }
  const result = await run(environment.SHELL || process.env.SHELL || "/bin/sh", ["-lc", "command -v pi"], environment);
  const detected = result.stdout.trim().split("\n").at(-1);
  if (result.status !== 0 || !path.isAbsolute(detected)) return null;
  try { return fs.realpathSync(detected); }
  catch { return null; }
}

async function probe(command, environment) {
  if (!command) return { version: null, compatible: false, capabilities: capabilitiesFromHelp("", false) };
  const [versionResult, helpResult] = await Promise.all([
    run(command, ["--version"], environment),
    run(command, ["--help"], environment),
  ]);
  const version = versionResult.status === 0 ? parseVersion(versionResult.stdout || versionResult.stderr) : null;
  const help = String(helpResult.stdout || helpResult.stderr || "");
  const capabilities = capabilitiesFromHelp(help, helpResult.status === 0);
  return { version, capabilities, compatible: Boolean(version && Object.values(capabilities).every(Boolean)) };
}

function nativeDescriptor({ command, environment, version, compatible, capabilities, checkedAt, agentDirOverride, commandSource }) {
  const explicitAgentDir = String(agentDirOverride || environment.PI_CODING_AGENT_DIR || "").trim();
  const home = environment.HOME || os.homedir();
  const expandedAgentDir = explicitAgentDir === "~"
    ? home
    : explicitAgentDir.startsWith("~/") ? path.join(home, explicitAgentDir.slice(2)) : explicitAgentDir;
  const agentDir = path.resolve(expandedAgentDir || path.join(home, ".pi", "agent"));
  const available = Boolean(command && version && compatible);
  return {
    id: "host-pi",
    label: "Host Pi",
    source: commandSource,
    command,
    commandArgs: [],
    agentDir,
    agentDirExplicit: Boolean(explicitAgentDir),
    agentDirSource: agentDirOverride ? "override" : environment.PI_CODING_AGENT_DIR ? "login-shell" : "default",
    environment,
    version,
    compatible,
    capabilities,
    available,
    checkedAt,
    error: !command
      ? "Host Pi was not found"
      : !version ? "Host Pi did not report a version"
        : !compatible ? "Host Pi does not support Conduit's required RPC capabilities" : null,
  };
}

export class PiInstallationRegistry {
  constructor({ conduitAgentDir, conduitCommand = "", nativeCommand = "", nativeAgentDir = "" }) {
    this.conduitAgentDir = path.resolve(conduitAgentDir);
    this.conduitCommandOverride = String(conduitCommand || "").trim();
    this.nativeCommandOverride = String(nativeCommand || "").trim();
    this.nativeAgentDirOverride = String(nativeAgentDir || "").trim();
    this.installations = new Map();
    this.detect();
  }

  detect() {
    const checkedAt = new Date().toISOString();
    const conduitCommand = this.conduitCommandOverride && path.isAbsolute(this.conduitCommandOverride)
      ? path.resolve(this.conduitCommandOverride)
      : this.conduitCommandOverride ? null : bundledCli;
    const conduitProbe = this.conduitCommandOverride
      ? probeSync(conduitCommand, process.env)
      : { version: VERSION, compatible: true, capabilities: capabilitiesFromHelp(REQUIRED_NATIVE_FLAGS.join(" ")) };
    const conduitAvailable = Boolean(conduitCommand && fs.existsSync(conduitCommand) && conduitProbe.version);
    this.installations.set("conduit-pinned", {
      id: "conduit-pinned",
      label: this.conduitCommandOverride ? "Isolated Pi override" : "Isolated Pi",
      source: this.conduitCommandOverride ? "override" : "bundled",
      command: conduitCommand,
      commandArgs: [],
      agentDir: this.conduitAgentDir,
      environment: process.env,
      version: conduitProbe.version,
      compatible: conduitProbe.compatible,
      capabilities: conduitProbe.capabilities,
      available: conduitAvailable,
      checkedAt,
      error: conduitAvailable ? null : "Conduit Pi executable is missing or did not report a version",
    });

    const environment = loginShellEnvironmentSync();
    const command = resolveCommandSync(this.nativeCommandOverride, environment);
    this.installations.set("host-pi", nativeDescriptor({
      command,
      environment,
      ...probeSync(command, environment),
      checkedAt,
      agentDirOverride: this.nativeAgentDirOverride,
      commandSource: this.nativeCommandOverride ? "override" : "login-shell",
    }));
    return this.list();
  }

  async detectHost() {
    const checkedAt = new Date().toISOString();
    const environment = await loginShellEnvironment();
    const command = await resolveCommand(this.nativeCommandOverride, environment);
    const installation = nativeDescriptor({
      command,
      environment,
      ...await probe(command, environment),
      checkedAt,
      agentDirOverride: this.nativeAgentDirOverride,
      commandSource: this.nativeCommandOverride ? "override" : "login-shell",
    });
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
    return this.list().map(({
      command,
      commandArgs: _args,
      agentDir,
      agentDirExplicit: _agentDirExplicit,
      environment: _environment,
      ...installation
    }) => ({ ...installation, executablePath: command || null, agentHome: { path: agentDir, source: installation.agentDirSource || installation.source } }));
  }
}
