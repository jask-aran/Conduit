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
  conduit-auth handoff [seconds]          Print a one-time sign-in code (default 60s).
  conduit-auth qr <text>                  Draw a QR code in the terminal.
  conduit-auth sessions                   Signed-in devices, as JSON.
  conduit-auth revoke <id>|all            Sign out one device, or all of them.
  conduit-auth mint-session [options]     Create a local session without a password.
  conduit-auth prepare-restart <hash> [s] Ready connected browsers for a restart to
                                          this service worker; wait up to s (20).

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
  } else if (command === "handoff") {
    const store = new AuthStore(authFile);
    const ttl = Number(process.argv[3]) || 60;
    process.stdout.write(`${await store.createHandoff({ ttlMs: ttl * 1000 })}\n`);
  } else if (command === "handoff-used") {
    // Exit 0 once the code has been redeemed (or has lapsed), 1 while it waits.
    const { hashToken } = await import("../conduit-web/src/auth-store.js");
    const store = new AuthStore(authFile);
    await store.load({ force: true });
    const hash = hashToken(process.argv[3] || "");
    process.exitCode = (store.data.handoffs || []).some((item) => item.codeHash === hash) ? 1 : 0;
  } else if (command === "qr") {
    // qr <text> -- the code drawn in half blocks, two rows to a line, with the quiet zone.
    const { default: QRCode } = await import("../conduit-web/node_modules/qrcode/lib/core/qrcode.js");
    const { modules } = QRCode.create(process.argv[3], { errorCorrectionLevel: "L" });
    const size = modules.size, quiet = 2;
    const dark = (x, y) => x >= 0 && y >= 0 && x < size && y < size && modules.get(y, x);
    const lines = [];
    for (let y = -quiet; y < size + quiet; y += 2) {
      let line = "";
      for (let x = -quiet; x < size + quiet; x += 1) {
        const top = dark(x, y), bottom = dark(x, y + 1);
        line += top && bottom ? " " : top ? "▄" : bottom ? "▀" : "█";
      }
      lines.push(line);
    }
    process.stdout.write(`${lines.join("\n")}\n`);
  } else if (command === "sessions") {
    const store = new AuthStore(authFile);
    await store.load();
    console.log(JSON.stringify(store.sessions().map((s) => ({ id: s.tokenHash.slice(0, 8), kind: s.kind, userAgent: s.userAgent, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt }))));
  } else if (command === "revoke") {
    const id = process.argv[3];
    if (!id || (id !== "all" && id.length < 4)) throw new Error("revoke <id>|all");
    console.log(await new AuthStore(authFile).removeSessionsByPrefix(id));
  } else if (command === "api") {
    // api METHOD /path [json] -- one request as a short-lived session, then signed out.
    const [method, route, body] = process.argv.slice(3);
    const store = new AuthStore(authFile);
    const { token } = await store.createSession({ userAgent: "conduit-server CLI" });
    try {
      const port = process.env.CONDUIT_PORT || 4310;
      const response = await fetch(`http://127.0.0.1:${port}${route}`, {
        method,
        headers: { cookie: `conduit_session=${token}`, "content-type": "application/json", origin: `http://127.0.0.1:${port}` },
        body: body || undefined,
      });
      process.stdout.write(`${await response.text()}\n`);
      if (!response.ok) process.exitCode = 1;
    } finally {
      await store.removeSession(token);
    }
  } else if (command === "prepare-restart") {
    // prepare-restart <target-hash> [seconds] -- tell connected browsers a
    // restart to this service worker is coming, then wait until every one the
    // server is waiting on has installed it, or the limit. One session for
    // the whole wait, signed out at the end.
    const [target = "", seconds = "20"] = process.argv.slice(3);
    const limit = Date.now() + Math.max(0, Number(seconds) || 0) * 1000;
    const store = new AuthStore(authFile);
    const { token } = await store.createSession({ userAgent: "conduit-server restart" });
    const port = process.env.CONDUIT_PORT || 4310;
    const call = async (method, route, body) => {
      const response = await fetch(`http://127.0.0.1:${port}${route}`, {
        method,
        headers: { cookie: `conduit_session=${token}`, "content-type": "application/json", origin: `http://127.0.0.1:${port}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw new Error(`${route} answered ${response.status}`);
      return response.json();
    };
    try {
      const attempt = crypto.randomUUID().replace(/-/g, "");
      let status = await call("POST", "/v0/runtime/restart/prepare", { attempt, target });
      const started = Date.now();
      while (status?.waiting?.length && Date.now() < limit) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        status = (await call("GET", "/v0/runtime/clients")).restart;
      }
      const waited = ((Date.now() - started) / 1000).toFixed(1);
      const left = status?.waiting?.length || 0;
      console.log(left
        ? `${status.ready}/${status.eligible} browsers ready after ${waited}s; restarting without ${left}.`
        : `${status?.eligible || 0} browser${status?.eligible === 1 ? "" : "s"} ready after ${waited}s.`);
    } finally {
      await store.removeSession(token);
    }
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
