#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_CONDUIT_ORIGIN,
  resolveLocalTarget,
} from "./agent-browser-target.mjs";

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

const requestedOrigin = process.env.CONDUIT_QA_ORIGIN || DEFAULT_CONDUIT_ORIGIN;
const requestedPath =
  optionValue("--path") || process.env.CONDUIT_QA_PATH || "/";
const target = resolveLocalTarget({
  rawOrigin: requestedOrigin,
  rawPath: requestedPath,
});

const socketDir =
  process.env.CONDUIT_AGENT_BROWSER_SOCKET_DIR ||
  path.join(tmpdir(), "conduit-agent-browser");
mkdirSync(socketDir, { recursive: true });
process.env.AGENT_BROWSER_SOCKET_DIR = socketDir;

function run(args, { capture = false } = {}) {
  const result = spawnSync("agent-browser", args, {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error("agent-browser is not installed or is not on PATH");
    }
    throw result.error;
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout?.trim() || "";
}

const session = process.env.AGENT_BROWSER_SESSION || run(
  ["session", "id", "--scope", "worktree", "--prefix", "conduit-qa"],
  { capture: true },
);
if (!session) throw new Error("agent-browser did not return a session id");

const browser = ["--session", session, "--restore"];
run([...browser, "open", target]);
run([...browser, "wait", "--load", "networkidle"]);
run([...browser, "snapshot", "-i", "-c"]);

process.stdout.write(`\nRestored agent-browser session: ${session}\n`);
process.stdout.write(`Target: ${target}\n`);
process.stdout.write(`Continue: agent-browser --session ${session} snapshot -i -c\n`);
process.stdout.write(`Close: agent-browser --session ${session} close\n`);
