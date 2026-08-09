#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateLocalAgentBrowserCommand } from "./agent-browser-target.mjs";

const args = process.argv.slice(2);
try {
  validateLocalAgentBrowserCommand(args);
} catch (error) {
  console.error(`Conduit local agent-browser: ${error.message}`);
  process.exit(2);
}

const socketDir =
  process.env.CONDUIT_AGENT_BROWSER_SOCKET_DIR ||
  path.join(tmpdir(), "conduit-agent-browser");
mkdirSync(socketDir, { recursive: true });
process.env.AGENT_BROWSER_SOCKET_DIR = socketDir;

const result = spawnSync("agent-browser", args, {
  encoding: "utf8",
  stdio: "inherit",
});
if (result.error) {
  if (result.error.code === "ENOENT") {
    console.error("agent-browser is not installed or is not on PATH");
    process.exit(1);
  }
  throw result.error;
}
if (result.status !== null) process.exit(result.status);
process.exit(1);
