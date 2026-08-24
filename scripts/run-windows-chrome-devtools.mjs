#!/usr/bin/env node
import {
  AGENT_USER_AGENT,
  DEFAULT_DEBUG_PORT,
  DEFAULT_ORIGIN,
  RUNTIME_DIR,
  buildChromeLaunchArgs,
  chromeDevtoolsStatus,
  cookieIsAuthenticated,
  cookieValue,
  injectSessionCookie,
  launchWindowsChrome,
  lookupWindowsLocalAppData,
  mintSessionToken,
  portIsOpen,
  readCookies,
  resolveChromeExecutable,
  resolveUserDataDir,
  runChromeDevtools,
  startChromeDevtoolsCli,
  waitForDevtools,
} from "./windows-chrome-devtools.mjs";

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage:
  run-windows-chrome-devtools [start|status|stop-cli|cli ...] [--port 9222] [--origin http://127.0.0.1:4310]

start   Launch the dedicated Windows Chrome profile if needed, reuse or
        mint a Conduit session without reading the password, inject the
        cookie, and attach chrome-devtools.
status  Report whether 127.0.0.1:<port> and the DevTools daemon are up.
cli     Run a chrome-devtools command with the pinned runtime dir.
stop-cli
        Stop the chrome-devtools daemon only. Leaves Windows Chrome running.

Environment:
  CONDUIT_WINDOWS_CHROME              Path to chrome.exe
  CONDUIT_WINDOWS_CHROME_USER_DATA_DIR
  CONDUIT_WINDOWS_LOCALAPPDATA
  CONDUIT_DEVTOOLS_PORT               Default 9222`);
}

async function resolveProfile() {
  try {
    return resolveUserDataDir();
  } catch {
    const localAppData = lookupWindowsLocalAppData();
    process.env.CONDUIT_WINDOWS_LOCALAPPDATA = localAppData;
    return resolveUserDataDir({ env: process.env });
  }
}

async function status(port) {
  const open = await portIsOpen(port);
  if (!open) {
    console.log(`Chrome DevTools: down (127.0.0.1:${port})`);
    return 1;
  }
  const version = await waitForDevtools(port, { timeoutMs: 2_000 });
  console.log(`Chrome DevTools: up (${version.Browser || "chrome"})`);
  console.log(`Attach: chrome-devtools start --browserUrl http://127.0.0.1:${port}`);
  return 0;
}

async function ensureAuthenticatedCookie(port, origin) {
  const existing = cookieValue(await readCookies(port, { origin }));
  if (existing && await cookieIsAuthenticated(existing, origin)) {
    return { token: existing, userAgent: AGENT_USER_AGENT, sessionCount: "reused", minted: false };
  }
  const minted = await mintSessionToken();
  if (!await cookieIsAuthenticated(minted.token, origin)) {
    throw new Error("minted session was not accepted by /v0/auth/status");
  }
  await injectSessionCookie({ port, token: minted.token, origin });
  const injected = cookieValue(await readCookies(port, { origin }));
  if (!injected) throw new Error("session cookie was not visible in the Chrome profile");
  return { ...minted, minted: true };
}

async function start(port, origin) {
  const executablePath = resolveChromeExecutable();
  const userDataDir = await resolveProfile();
  const args = buildChromeLaunchArgs({ port, userDataDir });
  if (!await portIsOpen(port)) {
    launchWindowsChrome({ executablePath, args });
  }
  await waitForDevtools(port);
  const session = await ensureAuthenticatedCookie(port, origin);
  startChromeDevtoolsCli({ port });
  const daemon = chromeDevtoolsStatus();
  if (!daemon.running) {
    throw new Error("chrome-devtools start returned but the daemon is not running");
  }
  console.log(`Windows Chrome profile: ${userDataDir}`);
  console.log(`DevTools: http://127.0.0.1:${port}`);
  console.log(`Session: ${session.userAgent} (${session.sessionCount}${session.minted ? "" : ", existing cookie"})`);
  console.log(`Runtime: XDG_RUNTIME_DIR=${RUNTIME_DIR}`);
  console.log("Continue: node ../scripts/run-windows-chrome-devtools.mjs cli list_pages");
  console.log("Trace: node ../scripts/run-windows-chrome-devtools.mjs cli performance_start_trace --autoStop");
}

const command = process.argv[2] || "start";
if (command === "-h" || command === "--help" || command === "help") {
  printHelp();
  process.exit(0);
}

const port = Number(optionValue("--port") || process.env.CONDUIT_DEVTOOLS_PORT || DEFAULT_DEBUG_PORT);
const origin = optionValue("--origin") || DEFAULT_ORIGIN;

try {
  if (command === "status") {
    const chrome = await status(port);
    const daemon = chromeDevtoolsStatus();
    console.log(`chrome-devtools daemon: ${daemon.running ? "up" : "down"}`);
    process.exit(chrome === 0 && daemon.running ? 0 : 1);
  }
  if (command === "cli") {
    const result = runChromeDevtools(process.argv.slice(3));
    process.exit(result.status ?? 1);
  }
  if (command === "stop-cli") {
    const result = runChromeDevtools(["stop"]);
    process.exit(result.status ?? 1);
  }
  if (command === "start") {
    await start(port, origin);
    process.exit(0);
  }
  throw new Error(`Unknown command: ${command}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
