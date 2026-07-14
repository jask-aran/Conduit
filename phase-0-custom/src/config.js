import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  return {
    host: env.CONDUIT_HOST || env.HOST || "127.0.0.1",
    port: Number(env.CONDUIT_PORT || env.PORT || 4310),
    piCommand: env.PI_COMMAND || "pi",
    filesRoot: absolute(env.CONDUIT_FILES_ROOT || path.join(repositoryRoot, "app/files")),
    stateDir,
    piWebProjectsFile: absolute(env.PI_WEB_PROJECTS_FILE || path.join(stateDir, "pi-web-projects.json")),
  };
}

