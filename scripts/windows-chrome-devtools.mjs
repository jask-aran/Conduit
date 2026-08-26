import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import {
  COOKIE_NAME,
  DEFAULT_ORIGIN,
  mintLocalSession,
} from "./conduit-local-auth.mjs";

export const DEFAULT_DEBUG_PORT = 9222;
export { DEFAULT_ORIGIN };
export const AGENT_USER_AGENT = "conduit-devtools-native";
export const RUNTIME_DIR = "/tmp/conduit-chrome-devtools";

const DEFAULT_WINDOWS_CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const DEFAULT_WSL_CHROME = "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe";
const PROFILE_SEGMENT = path.win32.join("Conduit", "chrome-agent");

export function resolveChromeExecutable({
  env = process.env,
  exists = existsSync,
} = {}) {
  const override = env.CONDUIT_WINDOWS_CHROME || env.CHROME_PATH;
  const candidates = [
    override,
    DEFAULT_WSL_CHROME,
    DEFAULT_WINDOWS_CHROME,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }
  throw new Error(
    "Windows Chrome was not found. Set CONDUIT_WINDOWS_CHROME to chrome.exe",
  );
}

export function windowsLocalAppData({ env = process.env } = {}) {
  if (env.CONDUIT_WINDOWS_LOCALAPPDATA) return env.CONDUIT_WINDOWS_LOCALAPPDATA;
  if (env.LOCALAPPDATA && /^[A-Za-z]:\\/.test(env.LOCALAPPDATA)) {
    return env.LOCALAPPDATA;
  }
  return null;
}

export function resolveUserDataDir({
  env = process.env,
  localAppData = windowsLocalAppData({ env }),
} = {}) {
  if (env.CONDUIT_WINDOWS_CHROME_USER_DATA_DIR) {
    return env.CONDUIT_WINDOWS_CHROME_USER_DATA_DIR;
  }
  if (!localAppData) {
    throw new Error(
      "Windows LocalAppData is unknown. Set CONDUIT_WINDOWS_CHROME_USER_DATA_DIR",
    );
  }
  return path.win32.join(localAppData, PROFILE_SEGMENT);
}

export function buildChromeLaunchArgs({
  port = DEFAULT_DEBUG_PORT,
  userDataDir,
} = {}) {
  if (!userDataDir) throw new Error("userDataDir is required");
  return [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "about:blank",
  ];
}

export function cookieParams(token, origin = DEFAULT_ORIGIN) {
  if (!token) throw new Error("session token is required");
  const url = new URL(origin);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    throw new Error("native DevTools auth only accepts http://127.0.0.1");
  }
  return {
    name: COOKIE_NAME,
    value: token,
    url: `${url.origin}/`,
    path: "/",
    httpOnly: true,
    secure: false,
    sameSite: "Lax",
  };
}

export function devtoolsHttpUrl(port = DEFAULT_DEBUG_PORT, route = "/json/version") {
  return `http://127.0.0.1:${port}${route}`;
}

export async function readDevtoolsVersion(port = DEFAULT_DEBUG_PORT, fetchImpl = fetch) {
  const response = await fetchImpl(devtoolsHttpUrl(port, "/json/version"));
  if (!response.ok) {
    throw new Error(`Chrome DevTools endpoint returned HTTP ${response.status}`);
  }
  return response.json();
}

export async function portIsOpen(port = DEFAULT_DEBUG_PORT, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(400);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForDevtools(port = DEFAULT_DEBUG_PORT, {
  timeoutMs = 15_000,
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  const deadline = now() + timeoutMs;
  let lastError = null;
  while (now() < deadline) {
    try {
      const version = await readDevtoolsVersion(port, fetchImpl);
      if (version?.webSocketDebuggerUrl) return version;
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  throw new Error(
    `Chrome did not expose DevTools on 127.0.0.1:${port}`
    + (lastError ? `: ${lastError.message}` : ""),
  );
}

export function launchWindowsChrome({
  executablePath,
  args,
  spawnImpl = spawn,
} = {}) {
  const child = spawnImpl(executablePath, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
  return child;
}

function nextCdpId(state) {
  state.id += 1;
  return state.id;
}

function listen(target, event, handler) {
  if (typeof target.on === "function") {
    target.on(event, handler);
    return () => {
      if (typeof target.off === "function") target.off(event, handler);
      else target.removeListener(event, handler);
    };
  }
  target.addEventListener(event, handler);
  return () => target.removeEventListener(event, handler);
}

function once(target, event) {
  return new Promise((resolve, reject) => {
    const stop = listen(target, event, (value) => {
      stop();
      stopError();
      resolve(value);
    });
    const stopError = listen(target, "error", (error) => {
      stop();
      stopError();
      reject(error instanceof Error ? error : new Error(String(error?.message || error)));
    });
  });
}

function messageData(raw) {
  if (typeof raw === "string") return raw;
  if (raw?.data != null) return String(raw.data);
  return String(raw);
}

export async function sendCdpCommand(socket, method, params, state) {
  const id = nextCdpId(state);
  const payload = JSON.stringify({ id, method, params });
  return new Promise((resolve, reject) => {
    const stop = listen(socket, "message", (raw) => {
      let message;
      try {
        message = JSON.parse(messageData(raw));
      } catch {
        return;
      }
      if (message.id !== id) return;
      stop();
      if (message.error) {
        reject(new Error(`${method} failed: ${message.error.message || "cdp error"}`));
        return;
      }
      resolve(message.result || {});
    });
    socket.send(payload);
  });
}

export async function listPageTargets(port = DEFAULT_DEBUG_PORT, fetchImpl = fetch) {
  const response = await fetchImpl(devtoolsHttpUrl(port, "/json/list"));
  if (!response.ok) {
    throw new Error(`Chrome target list returned HTTP ${response.status}`);
  }
  const targets = await response.json();
  return (Array.isArray(targets) ? targets : []).filter((target) => target?.type === "page");
}

export async function ensurePageTarget(port = DEFAULT_DEBUG_PORT, fetchImpl = fetch) {
  const existing = await listPageTargets(port, fetchImpl);
  const usable = existing.find((target) => target.webSocketDebuggerUrl);
  if (usable) return usable;
  const created = await fetchImpl(devtoolsHttpUrl(port, "/json/new?about:blank"));
  if (!created.ok) {
    throw new Error(`Chrome did not create a page target (HTTP ${created.status})`);
  }
  return created.json();
}

async function openSocket(url, WebSocketImpl) {
  const socket = new WebSocketImpl(url);
  if (socket.readyState === 1) return socket;
  await once(socket, "open");
  return socket;
}

function closeSocket(socket) {
  if (!socket || socket.readyState === 3) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 250);
    const stop = listen(socket, "close", () => {
      clearTimeout(timer);
      stop();
      resolve();
    });
    try {
      socket.close();
    } catch {
      clearTimeout(timer);
      stop();
      resolve();
    }
  });
}

export async function injectSessionCookie({
  port = DEFAULT_DEBUG_PORT,
  token,
  origin = DEFAULT_ORIGIN,
  fetchImpl = fetch,
  WebSocketImpl = globalThis.WebSocket,
} = {}) {
  const target = await ensurePageTarget(port, fetchImpl);
  if (!target.webSocketDebuggerUrl) {
    throw new Error("Chrome page target has no DevTools websocket");
  }
  const socket = await openSocket(target.webSocketDebuggerUrl, WebSocketImpl);
  const state = { id: 0 };
  try {
    await sendCdpCommand(socket, "Network.enable", {}, state);
    const result = await sendCdpCommand(socket, "Network.setCookie", cookieParams(token, origin), state);
    if (result.success === false) {
      throw new Error("Chrome rejected the session cookie");
    }
    await sendCdpCommand(socket, "Page.navigate", { url: `${new URL(origin).origin}/` }, state);
  } finally {
    await closeSocket(socket);
  }
}

export async function readCookies(port = DEFAULT_DEBUG_PORT, {
  origin = DEFAULT_ORIGIN,
  fetchImpl = fetch,
  WebSocketImpl = globalThis.WebSocket,
} = {}) {
  const target = await ensurePageTarget(port, fetchImpl);
  const socket = await openSocket(target.webSocketDebuggerUrl, WebSocketImpl);
  const state = { id: 0 };
  try {
    await sendCdpCommand(socket, "Network.enable", {}, state);
    return await sendCdpCommand(socket, "Network.getCookies", { urls: [`${new URL(origin).origin}/`] }, state);
  } finally {
    await closeSocket(socket);
  }
}

export async function mintSessionToken(options = {}) {
  return mintLocalSession({ userAgent: AGENT_USER_AGENT, ...options });
}

export async function cookieIsAuthenticated(token, origin = DEFAULT_ORIGIN, fetchImpl = fetch) {
  const response = await fetchImpl(new URL("/v0/auth/status", origin), {
    headers: { cookie: `${COOKIE_NAME}=${token}`, accept: "application/json" },
  });
  if (!response.ok) return false;
  const body = await response.json().catch(() => null);
  return Boolean(body?.authenticated);
}

export function chromeDevtoolsEnv(baseEnvironment = process.env) {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  return { ...baseEnvironment, XDG_RUNTIME_DIR: RUNTIME_DIR };
}

function throwIfMissingCli(error) {
  if (error?.code === "ENOENT") {
    throw new Error("chrome-devtools is not installed or is not on PATH");
  }
  if (error) throw error;
}

export function chromeDevtoolsStatus({
  spawnSyncImpl = spawnSync,
  env = process.env,
} = {}) {
  const result = spawnSyncImpl("chrome-devtools", ["status"], {
    encoding: "utf8",
    env: chromeDevtoolsEnv(env),
  });
  throwIfMissingCli(result.error);
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  return { running: /daemon is running/i.test(output), output, status: result.status };
}

export function startChromeDevtoolsCli({
  port = DEFAULT_DEBUG_PORT,
  spawnSyncImpl = spawnSync,
  env = process.env,
} = {}) {
  const result = spawnSyncImpl(
    "chrome-devtools",
    ["start", "--browserUrl", `http://127.0.0.1:${port}`],
    { encoding: "utf8", timeout: 20_000, env: chromeDevtoolsEnv(env) },
  );
  throwIfMissingCli(result.error);
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "chrome-devtools start failed").trim());
  }
  return result;
}

export function runChromeDevtools(args, {
  spawnSyncImpl = spawnSync,
  env = process.env,
  stdio = "inherit",
} = {}) {
  const result = spawnSyncImpl("chrome-devtools", args, {
    encoding: "utf8",
    env: chromeDevtoolsEnv(env),
    stdio,
  });
  throwIfMissingCli(result.error);
  return result;
}

export function cookieValue(cookies, name = COOKIE_NAME) {
  return (cookies?.cookies || []).find((cookie) => cookie.name === name)?.value || null;
}

export function lookupWindowsLocalAppData(spawnSyncImpl = spawnSync) {
  const result = spawnSyncImpl(
    "powershell.exe",
    ["-NoProfile", "-Command", "[Environment]::GetFolderPath('LocalApplicationData')"],
    { encoding: "utf8" },
  );
  const value = String(result.stdout || "").trim();
  if (result.status !== 0 || !value) {
    throw new Error("Could not resolve Windows LocalAppData");
  }
  return value;
}
