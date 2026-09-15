import { spawnSync } from "node:child_process";
import fs from "node:fs";
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

function probeSync(command, environment) {
  if (!command) return { version: null, compatible: false, capabilities: capabilitiesFromHelp("", false) };
  const versionResult = spawnSync(command, ["--version"], { encoding: "utf8", env: environment, timeout: 5000 });
  const helpResult = spawnSync(command, ["--help"], { encoding: "utf8", env: environment, timeout: 5000 });
  const version = versionResult.status === 0 ? parseVersion(versionResult.stdout || versionResult.stderr) : null;
  const help = String(helpResult.stdout || helpResult.stderr || "");
  const capabilities = capabilitiesFromHelp(help, helpResult.status === 0);
  return { version, capabilities, compatible: Boolean(version && Object.values(capabilities).every(Boolean)) };
}

export class PiInstallationRegistry {
  constructor({ conduitAgentDir, conduitCommand = "" }) {
    this.conduitAgentDir = path.resolve(conduitAgentDir);
    this.conduitCommandOverride = String(conduitCommand || "").trim();
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
      label: this.conduitCommandOverride ? "Conduit Pi override" : "Conduit Pi",
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

    return this.list();
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
