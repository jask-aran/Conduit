#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { AuthStore, statusSummary } from "../conduit-web/src/auth-store.js";
import {
  DEFAULT_AGENT_USER,
  DEFAULT_ORIGIN,
  mintLocalSession,
  resolveLocalAuthFile,
  sessionArtifact,
} from "./conduit-local-auth.mjs";

const authFile = resolveLocalAuthFile();

function printHelp() {
  console.log(`Usage:
  conduit-auth set-password [--stdin]     Set or replace the Conduit login password.
                                          Reads from stdin when --stdin is given,
                                          otherwise prompts twice (hidden input).
                                          Replaces the password and signs out
                                          every existing session.
  conduit-auth reset-sessions             Clears the sessions array, signing out
                                          every device. The password is unchanged.
  conduit-auth status                     Reports whether a password is set and the
                                          active session count.
  conduit-auth mint-session [options]     Create a local session without a password.

Mint options:
  --user-agent <label>                    Session label (default: ${DEFAULT_AGENT_USER}).
  --format <token|cookie|json|playwright> Output format (default: token).
  --output <path>                         Write mode-0600 output instead of stdout.
  --origin <url>                          Cookie origin (default: ${DEFAULT_ORIGIN}).

Environment:
  CONDUIT_DATA_ROOT    Override the durable data root (default: data).
  CONDUIT_AUTH_FILE    Override auth.json within that root.`);
}

async function readHidden(promptText) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: createHiddenOutput(process.stdout) });
    rl.question(promptText, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    rl.on("error", reject);
  });
}

function createHiddenOutput(target) {
  let pending = "";
  return new Proxy(target, {
    get(t, prop) {
      if (prop === "write") {
        return (chunk, callback) => {
          if (chunk && typeof chunk === "string" && chunk.includes("\n")) {
            if (pending) { t.write(pending, callback); pending = ""; }
            else t.write("\n", callback);
            return;
          }
          pending += chunk || "";
          if (callback) callback();
        };
      }
      const value = t[prop];
      return typeof value === "function" ? value.bind(t) : value;
    },
  });
}

async function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(chunks.join("").replace(/\r?\n$/, "")));
    process.stdin.on("error", reject);
  });
}

async function ensureDataDir() {
  await fs.mkdir(path.dirname(authFile), { recursive: true });
}

async function setPassword() {
  let password;
  if (process.argv.includes("--stdin")) {
    password = await readStdin();
  } else {
    if (!process.stdin.isTTY) {
      console.error("No TTY available. Pass --stdin to pipe the password.");
      process.exitCode = 1;
      return;
    }
    const first = await readHidden("New password: ");
    if (!first) {
      console.error("Password cannot be empty.");
      process.exitCode = 1;
      return;
    }
    const second = await readHidden("Confirm password: ");
    if (first !== second) {
      console.error("Passwords do not match.");
      process.exitCode = 1;
      return;
    }
    password = first;
  }
  await ensureDataDir();
  const store = new AuthStore(authFile);
  await store.setPassword(password);
  console.log(`Password saved to ${authFile}. All sessions were invalidated.`);
}

async function resetSessions() {
  const store = new AuthStore(authFile);
  await store.resetSessions();
  console.log(`Cleared all sessions in ${authFile}.`);
}

async function status() {
  const store = new AuthStore(authFile);
  await store.load();
  const summary = statusSummary(store);
  console.log(`Password set: ${summary.hasPassword ? "yes" : "no"}`);
  console.log(`Active sessions: ${summary.sessionCount}`);
  console.log(`Auth file: ${authFile}`);
}

async function mintSession() {
  const valueAfter = (name, fallback) => {
    const index = process.argv.indexOf(name);
    if (index === -1) return fallback;
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
    return value;
  };
  const format = process.argv.includes("--json")
    ? "json"
    : valueAfter("--format", "token");
  const session = await mintLocalSession({
    authFile,
    userAgent: valueAfter("--user-agent", DEFAULT_AGENT_USER),
  });
  const output = sessionArtifact(session, {
    format,
    origin: valueAfter("--origin", DEFAULT_ORIGIN),
  });
  const outputPath = valueAfter("--output", null);
  if (!outputPath) {
    process.stdout.write(output);
    return;
  }
  await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await fs.writeFile(path.resolve(outputPath), output, { mode: 0o600 });
  await fs.chmod(path.resolve(outputPath), 0o600);
}

const command = process.argv[2];
try {
  if (!command || command === "-h" || command === "--help" || command === "help") {
    printHelp();
  } else if (command === "set-password") {
    await setPassword();
  } else if (command === "reset-sessions") {
    await resetSessions();
  } else if (command === "status") {
    await status();
  } else if (command === "mint-session") {
    await mintSession();
  } else {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
