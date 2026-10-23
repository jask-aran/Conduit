import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The harnesses installed on this device that Conduit may drive here (plan
 * decision 5): main's adapter for each runs against a process the node starts
 * (remote spawn), so the node only finds the command and reads back what the
 * harness saved -- one adapter per harness, all on main.
 *
 * Running a harness is running code as this device's user, so the node
 * offers its harnesses only when it shares a folder with the shell grant, and
 * starts one only in such a folder.
 */
// The names to look for, first found wins: the adapter speaks OpenCode 2, which installs as opencode2.
const COMMANDS = { "claude-code": ["claude"], codex: ["codex"], fx: ["fx"], opencode: ["opencode2", "opencode"] };

function onPath(command) {
  // On Windows only an .exe: a .cmd shim needs a shell to run, and argv through cmd.exe is not argv.
  const extensions = process.platform === "win32" ? [".exe"] : [""];
  for (const directory of String(process.env.PATH || "").split(path.delimiter)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, command + extension);
      try { fs.accessSync(candidate, fs.constants.X_OK); if (fs.statSync(candidate).isFile()) return candidate; } catch { /* keep looking */ }
    }
  }
  return null;
}

export function findHarnesses() {
  return Object.fromEntries(Object.entries(COMMANDS)
    // Codex's app-server daemon is Unix-only (it lives behind a Unix socket): on Windows it is not offered.
    .filter(([id]) => !(id === "codex" && process.platform === "win32"))
    .map(([id, names]) => [id, names.map(onPath).find(Boolean)]).filter(([, found]) => found));
}

/**
 * Where a tunnel may lead on this device: a harness's own socket, by name, or
 * a loopback port. Only with the shell grant somewhere -- a command could
 * reach either anyway.
 */
export function tunnelTarget(endpoint) {
  if (endpoint?.harness === "codex") {
    return { path: path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "app-server-control", "app-server-control.sock") };
  }
  const port = Number(endpoint?.port);
  if (Number.isInteger(port) && port > 0 && port < 65536) return { host: "127.0.0.1", port };
  return null;
}

/** A Codex thread's rollout file on this device, by its id; null if there is none. */
export async function codexRollout(threadId) {
  if (!SESSION_ID.test(String(threadId))) return null;
  const root = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sessions");
  const name = (await fs.promises.readdir(root, { recursive: true }).catch(() => [])).find((file) => file.endsWith(`${threadId}.jsonl`));
  return name ? fs.promises.readFile(path.join(root, name), "utf8").catch(() => null) : null;
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A Claude Code session's saved transcript on this device, by its id; null if there is none. */
export async function claudeSession(sessionId) {
  if (!SESSION_ID.test(String(sessionId))) return null;
  const root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");
  for (const dir of await fs.promises.readdir(root).catch(() => [])) {
    try { return await fs.promises.readFile(path.join(root, dir, `${sessionId}.jsonl`), "utf8"); } catch { /* not this project */ }
  }
  return null;
}

/**
 * Where OpenCode's background service listens on this device, and its
 * password, as OpenCode's own state and config files say; `{}` if no live
 * service is recorded. Main asks `opencode service status` for the rest.
 */
export async function opencodeService() {
  const file = async (variable, fallback) => {
    const root = process.env[variable] || path.join(os.homedir(), fallback);
    try { return JSON.parse(await fs.promises.readFile(path.join(root, "opencode", "service.json"), "utf8")); } catch { return {}; }
  };
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (cause) { return cause.code === "EPERM"; } };
  const state = await file("XDG_STATE_HOME", ".local/state");
  const url = /^http:\/\/127\.0\.0\.1:\d+$/.test(state.url || "") && Number.isInteger(state.pid) && alive(state.pid) ? state.url : "";
  const password = process.env.OPENCODE_SERVER_PASSWORD || state.password || (await file("XDG_CONFIG_HOME", ".config")).password || "";
  return { url, password };
}
