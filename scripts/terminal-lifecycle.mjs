import crypto from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function terminalSocketName(filePath) {
  const namespace = crypto.createHash("sha256").update(path.resolve(filePath)).digest("hex").slice(0, 12);
  return `conduit-${namespace}`;
}

/** Where tmux keeps a `-L` socket: `$TMUX_TMPDIR` (or /tmp), then one directory per user. */
export function terminalSocketPath(name, env = process.env) {
  return path.join(env.TMUX_TMPDIR || "/tmp", `tmux-${process.getuid()}`, name);
}

/**
 * A tmux server that has stopped answering still holds its socket, and tmux
 * then refuses every command with "server exited unexpectedly" -- `kill-server`
 * included. The socket is Conduit's alone, so it is removed instead; the next
 * command starts a fresh server.
 */
export async function removeUnresponsiveSocket(name, error) {
  if (!/server exited unexpectedly/i.test(String(error?.stderr || error?.message || ""))) return false;
  await fs.rm(terminalSocketPath(name), { force: true });
  return true;
}

export function terminalRegistryFile(env = process.env) {
  const dataRoot = path.resolve(env.CONDUIT_DATA_ROOT || path.join(repositoryRoot, "data"));
  return path.resolve(env.CONDUIT_REMOTES_FILE || path.join(dataRoot, "remotes.json"));
}

export async function stopTerminalSessions({
  filePath = terminalRegistryFile(),
  tmuxPath = process.env.CONDUIT_TMUX_PATH || "tmux",
  run = execFile,
} = {}) {
  const env = { ...process.env };
  delete env.TMUX;
  delete env.TMUX_PANE;
  const name = terminalSocketName(filePath);
  try {
    await run(tmuxPath, ["-L", name, "kill-server"], {
      env,
      maxBuffer: 64 * 1024,
    });
    return true;
  } catch (error) {
    const detail = String(error?.stderr || error?.message || "");
    if (error?.code === "ENOENT" || /no server running|no sessions|error connecting to .+ \(No such file or directory\)/i.test(detail)) {
      return false;
    }
    if (await removeUnresponsiveSocket(name, error)) return true;
    throw error;
  }
}

export function terminalCleanupMessage(stopped) {
  return stopped ? "Stopped leftover Conduit terminal sessions." : "Terminal cleanup found no leftover tmux server to stop.";
}

async function main() {
  const stopped = await stopTerminalSessions();
  console.log(terminalCleanupMessage(stopped));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Could not stop Conduit terminal sessions: ${error.message}`);
    process.exitCode = 1;
  });
}
