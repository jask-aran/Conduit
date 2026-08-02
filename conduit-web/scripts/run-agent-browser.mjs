#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const origin = process.env.CONDUIT_QA_ORIGIN || "http://127.0.0.1:4310";

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
run([...browser, "open", origin]);
run([...browser, "wait", "--load", "networkidle"]);
run([...browser, "snapshot", "-i", "-c"]);

process.stdout.write(`\nRestored agent-browser session: ${session}\n`);
process.stdout.write(`Continue: agent-browser --session ${session} snapshot -i -c\n`);
process.stdout.write(`Close: agent-browser --session ${session} close\n`);
