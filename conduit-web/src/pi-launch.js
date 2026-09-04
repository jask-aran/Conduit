import path from "node:path";
import {
  buildManagedToolEnvironment,
  buildPiEnvironment,
  buildPiResourceArgs,
  resolvePiProcess,
} from "../../scripts/pi-runtime.mjs";

const SENSITIVE_ENV = /^(?:CONDUIT_|COOKIE|SESSION|BROKER|EDGE_AUTH|AUTH_TOKEN|GITHUB_TOKEN|GH_TOKEN$)/i;

function filteredEnvironment(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !SENSITIVE_ENV.test(key)));
}

function nativeEnvironment(installation) {
  const env = installation.environment || process.env;
  const filtered = filteredEnvironment(env);
  delete filtered.PI_CODING_AGENT_SESSION_DIR;
  if (installation.agentDirExplicit) filtered.PI_CODING_AGENT_DIR = installation.agentDir;
  else delete filtered.PI_CODING_AGENT_DIR;
  return buildManagedToolEnvironment(filtered);
}

function sessionArgs(sessionFile, model, thinkingLevel) {
  const args = [];
  if (sessionFile) args.push("--session", path.resolve(sessionFile));
  if (model?.trim()) args.push("--model", model.trim());
  if (thinkingLevel?.trim()) args.push("--thinking", thinkingLevel.trim());
  return args;
}

export function resolvePiLaunch({
  chat,
  project,
  installation,
  template,
  models,
  model = "",
  thinkingLevel = "",
  bridgeSystemPrompt,
  bridgeSkill,
  runtimeAgentDir = "",
  modelProfile = null,
}) {
  if (!installation?.available || !installation.command) {
    const error = new Error(installation?.error || "Pi installation is unavailable");
    error.code = chat?.runtime?.kind === "native_pi" ? "native_pi_unavailable" : "runtime_version_unavailable";
    throw error;
  }
  const cwd = path.resolve(project.workingRoot || project.path);
  const runtime = chat.runtime;
  const processSpec = resolvePiProcess(installation.command, installation.commandArgs || []);
  if (runtime.kind === "native_pi") {
    if (!bridgeSystemPrompt || !bridgeSkill) throw new Error("Native Pi requires the Conduit bridge");
    return {
      command: processSpec.command,
      args: [
        ...processSpec.args,
        "--mode", "rpc",
        "--append-system-prompt", path.resolve(bridgeSystemPrompt),
        "--skill", path.resolve(bridgeSkill),
        ...sessionArgs(chat.piSessionFile, model, thinkingLevel),
      ],
      cwd,
      env: nativeEnvironment(installation),
      sessionFile: chat.piSessionFile ? path.resolve(chat.piSessionFile) : null,
      runtime,
      binaryVersion: installation.version,
      trustPosture: "native_saved_trust",
      modelProfile: null,
    };
  }

  if (!template) {
    const error = new Error(`Profile ${runtime.profileId || "unknown"} is unavailable`);
    error.code = "profile_version_unavailable";
    throw error;
  }
  return {
    command: processSpec.command,
    args: [
      ...processSpec.args,
      "--mode", "rpc",
      ...buildPiResourceArgs(models ? { ...template, models } : template),
      ...sessionArgs(chat.piSessionFile, model, thinkingLevel),
    ],
    cwd,
    env: buildPiEnvironment(runtimeAgentDir || installation.agentDir, filteredEnvironment(installation.environment || process.env)),
    sessionFile: chat.piSessionFile ? path.resolve(chat.piSessionFile) : null,
    runtime,
    binaryVersion: installation.version,
    trustPosture: "ignore_project_resources",
    modelProfile,
  };
}
