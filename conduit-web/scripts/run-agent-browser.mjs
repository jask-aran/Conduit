#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mintLocalSession } from "../../scripts/conduit-local-auth.mjs";
import {
  DEFAULT_CONDUIT_ORIGIN,
  resolveLocalTarget,
} from "./agent-browser-target.mjs";
import { spawnLocalAgentBrowser } from "./agent-browser-runtime.mjs";

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

function run(args, { capture = false } = {}) {
  const result = spawnLocalAgentBrowser(args, { capture });
  if (result.status !== 0) throw new Error(`agent-browser exited with status ${result.status ?? 1}`);
  return result.stdout?.trim() || "";
}

const session = process.env.AGENT_BROWSER_SESSION || run(
  ["session", "id", "--scope", "worktree", "--prefix", "conduit-qa"],
  { capture: true },
);
if (!session) throw new Error("agent-browser did not return a session id");

const browser = ["--session", session, "--restore"];
const minted = await mintLocalSession({ userAgent: "conduit-agent-browser" });
const authDir = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-agent-auth-"));
const cookieFile = path.join(authDir, "cookie");
try {
  await fs.writeFile(cookieFile, `conduit_session=${minted.token}\n`, { mode: 0o600 });
  run([...browser, "cookies", "set", "--curl", cookieFile]);
  run([...browser, "open", target]);
  run([...browser, "wait", "--load", "networkidle"]);
  run([...browser, "snapshot", "-i", "-c"]);
} finally {
  await fs.rm(authDir, { recursive: true, force: true });
}

process.stdout.write(`\nRestored agent-browser session: ${session}\n`);
process.stdout.write(`Target: ${target}\n`);
process.stdout.write(
  `Continue: npm run agent-browser:local -- --session ${session} --restore snapshot -i -c\n`,
);
process.stdout.write(
  `Close: npm run agent-browser:local -- --session ${session} close\n`,
);
