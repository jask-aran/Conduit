import os from "node:os";
import path from "node:path";

function expandHome(value) {
  if (!value) return value;
  return value === "~" ? os.homedir() : value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

export function loadConfig(env = process.env) {
  return {
    host: env.HOST || "127.0.0.1",
    port: Number(env.PORT || 4310),
    piCommand: env.PI_COMMAND || "pi",
    sessionsDir: path.resolve(expandHome(env.PI_SESSIONS_DIR || "~/.pi/agent/sessions")),
  };
}

