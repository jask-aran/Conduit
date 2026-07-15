import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPiTemplate } from "../../scripts/pi-runtime.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function expandHome(value) {
  if (!value) return value;
  return value === "~" ? os.homedir() : value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

function absolute(value) {
  return path.resolve(expandHome(value));
}

export function loadConfig(env = process.env) {
  const piTemplate = loadPiTemplate(env.CONDUIT_PI_TEMPLATE || path.join(repositoryRoot, "templates/chat/template.json"));
  return {
    host: env.CONDUIT_HOST || env.HOST || "127.0.0.1",
    port: Number(env.CONDUIT_PORT || env.PORT || 4310),
    piCommand: env.PI_COMMAND || "pi",
    filesRoot: absolute(env.CONDUIT_FILES_ROOT || path.join(repositoryRoot, "data/chat/files")),
    catalogFile: absolute(env.CONDUIT_CATALOG_FILE || path.join(repositoryRoot, "data/conduit.json")),
    piAgentDir: absolute(env.CONDUIT_PI_AGENT_DIR || path.join(repositoryRoot, "data/pi")),
    piTemplate,
  };
}
