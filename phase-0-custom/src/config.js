import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPiProfile } from "../../scripts/pi-runtime.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function expandHome(value) {
  if (!value) return value;
  return value === "~" ? os.homedir() : value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

function absolute(value) {
  return path.resolve(expandHome(value));
}

export function loadConfig(env = process.env) {
  const stateDir = absolute(env.CONDUIT_STATE_DIR || path.join(repositoryRoot, "app/state"));
  const piProfile = loadPiProfile(env.CONDUIT_PI_PROFILE || path.join(repositoryRoot, ".pi/experiences/chat/profile.json"));
  return {
    host: env.CONDUIT_HOST || env.HOST || "127.0.0.1",
    port: Number(env.CONDUIT_PORT || env.PORT || 4310),
    piCommand: env.PI_COMMAND || "pi",
    filesRoot: absolute(env.CONDUIT_FILES_ROOT || path.join(repositoryRoot, "app/files")),
    stateDir,
    piAgentDir: absolute(env.CONDUIT_PI_AGENT_DIR || path.join(stateDir, "pi-agent")),
    piWebProjectsFile: absolute(env.PI_WEB_PROJECTS_FILE || path.join(stateDir, "pi-web-projects.json")),
    piProfile,
  };
}
