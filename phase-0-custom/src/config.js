import fs from "node:fs";
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

function loadPiProfile(file) {
  const profileFile = absolute(file);
  const directory = path.dirname(profileFile);
  const profile = JSON.parse(fs.readFileSync(profileFile, "utf8"));
  const paths = (values = []) => values.map((value) => path.resolve(directory, value));
  return {
    profileFile,
    systemPrompt: path.resolve(directory, profile.systemPrompt || "SYSTEM.md"),
    tools: profile.tools || ["read", "bash", "edit", "write"],
    extensions: paths(profile.extensions),
    skills: paths(profile.skills),
    promptTemplates: paths(profile.promptTemplates),
  };
}

export function loadConfig(env = process.env) {
  const stateDir = absolute(env.CONDUIT_STATE_DIR || path.join(repositoryRoot, "app/state"));
  const piProfile = loadPiProfile(env.CONDUIT_PI_PROFILE || path.join(repositoryRoot, "phase-0-custom/pi/profile.json"));
  return {
    host: env.CONDUIT_HOST || env.HOST || "127.0.0.1",
    port: Number(env.CONDUIT_PORT || env.PORT || 4310),
    piCommand: env.PI_COMMAND || "pi",
    filesRoot: absolute(env.CONDUIT_FILES_ROOT || path.join(repositoryRoot, "app/files")),
    stateDir,
    piWebProjectsFile: absolute(env.PI_WEB_PROJECTS_FILE || path.join(stateDir, "pi-web-projects.json")),
    piProfile,
  };
}
