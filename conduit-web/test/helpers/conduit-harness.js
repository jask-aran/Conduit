import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

export async function waitFor(check, message, { attempts = 160, delayMs = 25 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(message);
}

async function readJsonLines(file) {
  try {
    return (await fs.readFile(file, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeFakePi(root) {
  const conduitPi = path.join(root, "conduit-pi");
  await fs.writeFile(conduitPi, `#!/usr/bin/env node
if (process.argv.includes("--version")) { console.log("0.80.6"); process.exit(0); }
if (process.argv.includes("--help")) { console.log("--mode --session --append-system-prompt --skill --approve --no-approve"); process.exit(0); }
const fs = require("node:fs");
const readline = require("node:readline");
const commandLog = process.env.TEST_PI_COMMAND_LOG;
const eventLog = process.env.TEST_PI_EVENT_LOG;
const input = readline.createInterface({ input: process.stdin });
let eventOffset = 0;
input.on("line", (line) => {
  const command = JSON.parse(line);
  fs.appendFileSync(commandLog, JSON.stringify({ pid: process.pid, command }) + "\\n");
});
function flushEvents() {
  let lines = [];
  try { lines = fs.readFileSync(eventLog, "utf8").split("\\n").filter(Boolean); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  while (eventOffset < lines.length) {
    const row = JSON.parse(lines[eventOffset]);
    eventOffset += 1;
    if (row.pid && row.pid !== process.pid) continue;
    process.stdout.write(JSON.stringify(row.event) + "\\n");
  }
  setTimeout(flushEvents, 5);
}
flushEvents();
`);
  await fs.chmod(conduitPi, 0o755);
  const nativePi = path.join(root, "native-pi");
  await fs.copyFile(conduitPi, nativePi);
  await fs.chmod(nativePi, 0o755);
  return { conduitPi, nativePi };
}

function deferredEvent(events, predicate, timeoutMs) {
  const existing = events.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      events.listeners.delete(listener);
      reject(new Error("Timed out waiting for protocol event"));
    }, timeoutMs);
    const listener = (event) => {
      if (!predicate(event)) return;
      clearTimeout(deadline);
      events.listeners.delete(listener);
      resolve(event);
    };
    events.listeners.add(listener);
  });
}

/**
 * A black-box Conduit fixture: production server process, public HTTP/WS/SSE
 * contracts, and only the Pi executable replaced by a controllable RPC peer.
 */
export async function startConduitHarness({ env = {} } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-harness-"));
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const commandLog = path.join(root, "pi-commands.jsonl");
  const eventLog = path.join(root, "pi-events.jsonl");
  const { conduitPi, nativePi } = await writeFakePi(root);
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: path.resolve(import.meta.dirname, "../.."),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HOME: root,
      CONDUIT_HOST: "127.0.0.1",
      CONDUIT_PORT: String(port),
      CONDUIT_FILES_ROOT: path.join(root, "files"),
      CONDUIT_CATALOG_FILE: path.join(root, "conduit.json"),
      CONDUIT_SESSION_REGISTRY_FILE: path.join(root, "sessions.json"),
      CONDUIT_PREFERENCES_FILE: path.join(root, "preferences.json"),
      CONDUIT_AUTH_FILE: path.join(root, "auth.json"),
      CONDUIT_REMOTES_FILE: path.join(root, "remotes.json"),
      CONDUIT_PI_AGENT_DIR: path.join(root, "pi"),
      CONDUIT_PI_COMMAND: conduitPi,
      CONDUIT_NATIVE_PI_COMMAND: nativePi,
      CONDUIT_NATIVE_PI_AGENT_DIR: path.join(root, "native-agent"),
      CONDUIT_WORKSPACE_ALLOWLIST: root,
      TEST_PI_COMMAND_LOG: commandLog,
      TEST_PI_EVENT_LOG: eventLog,
      ...env,
    },
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  try {
    await waitFor(async () => {
      if (child.exitCode != null) throw new Error(`Conduit server exited with ${child.exitCode}: ${output}`);
      try { return (await fetch(`${origin}/healthz`)).ok; }
      catch { return false; }
    }, "Conduit server did not become ready");
  } catch (error) {
    child.kill("SIGTERM");
    await fs.rm(root, { recursive: true, force: true });
    throw error;
  }

  const request = async (route, options = {}) => {
    try {
      return await fetch(`${origin}${route}`, {
        ...options,
        headers: { "content-type": "application/json", ...options.headers },
      });
    } catch (error) {
      error.message = `${error.message}; Conduit exit=${child.exitCode}; output=${output}`;
      throw error;
    }
  };
  const pi = {
    commands: () => readJsonLines(commandLog),
    async waitForCommand(type, { after = 0 } = {}) {
      let found = null;
      await waitFor(async () => {
        const commands = await readJsonLines(commandLog);
        found = commands.slice(after).find((row) => row.command.type === type) || null;
        return Boolean(found);
      }, `Pi did not receive ${type}`);
      return found;
    },
    async emit(event, { pid = null } = {}) {
      await fs.appendFile(eventLog, `${JSON.stringify({ pid, event })}\n`);
    },
    async reply(command, data, { success = true } = {}) {
      await pi.emit({
        id: command.command.id,
        type: "response",
        command: command.command.type,
        success,
        ...(success ? { data } : { error: String(data || "Pi RPC request failed") }),
      }, { pid: command.pid });
    },
  };
  const streams = new Set();
  return {
    root,
    origin,
    request,
    pi,
    async createProject(name) {
      const response = await request("/v0/projects", { method: "POST", body: JSON.stringify({ name }) });
      if (!response.ok) throw new Error(`Could not create project: ${response.status} ${await response.text()}`);
      return response.json();
    },
    async createChat(projectId = "project_chat") {
      const response = await request("/v0/chats", { method: "POST", body: JSON.stringify({ projectId }) });
      if (!response.ok) throw new Error(`Could not create chat: ${response.status} ${await response.text()}`);
      return response.json();
    },
    async liveSessions() {
      return (await (await request("/v0/live-sessions")).json()).sessions;
    },
    async runtime() {
      return (await (await request("/v0/runtime")).json()).sessions;
    },
    connectStream(liveId, { pauseAfterDelta = null, pauseMs = 0 } = {}) {
      const messages = [];
      const frames = [];
      const events = { listeners: new Set(), find: (predicate) => messages.find(predicate) };
      const socket = new WebSocket(`${origin.replace("http", "ws")}/v0/live-sessions/${liveId}/stream`);
      let deltaCount = 0;
      let pauseStartedAt = null;
      let clientPauseMs = null;
      let clientPauseRecovered = false;
      socket.on("message", (data) => {
        const event = JSON.parse(String(data));
        messages.push(event);
        frames.push({ event, receivedAt: performance.now() });
        if (event.type === "content_block_delta") {
          deltaCount += 1;
          if (pauseAfterDelta != null && deltaCount === pauseAfterDelta && pauseMs > 0 && socket._socket) {
            pauseStartedAt = performance.now();
            socket._socket.pause();
            setTimeout(() => {
              socket._socket.resume();
              clientPauseMs = performance.now() - pauseStartedAt;
              clientPauseRecovered = true;
            }, pauseMs);
          }
        }
        for (const listener of events.listeners) listener(event);
      });
      const opened = new Promise((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      const stream = {
        socket,
        messages,
        frames,
        get clientPauseMs() { return clientPauseMs; },
        get clientPauseRecovered() { return clientPauseRecovered; },
        opened,
        next: (predicate = () => true, timeoutMs = 2_000) => deferredEvent(events, predicate, timeoutMs),
        close: () => socket.close(),
      };
      streams.add(stream);
      return stream;
    },
    connectRuntimeStream() {
      const messages = [];
      const events = { listeners: new Set(), find: (predicate) => messages.find(predicate) };
      const controller = new AbortController();
      let opened = false;
      let resolveOpened;
      let rejectOpened;
      const openedPromise = new Promise((resolve, reject) => {
        resolveOpened = resolve;
        rejectOpened = reject;
      });
      const stream = {
        messages,
        opened: openedPromise,
        next: (predicate = () => true, timeoutMs = 2_000) => deferredEvent(events, predicate, timeoutMs),
        close: () => controller.abort(),
      };
      streams.add(stream);
      (async () => {
        try {
          const response = await fetch(`${origin}/v0/runtime/stream`, { signal: controller.signal });
          if (!response.ok || !response.body) throw new Error(`Could not open runtime stream: ${response.status}`);
          opened = true;
          resolveOpened();
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let pending = "";
          while (!controller.signal.aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            pending += decoder.decode(value, { stream: true });
            const frames = pending.split("\n\n");
            pending = frames.pop();
            for (const frame of frames) {
              const data = frame.split("\n").find((line) => line.startsWith("data: "));
              if (!data) continue;
              const event = JSON.parse(data.slice(6));
              messages.push(event);
              for (const listener of events.listeners) listener(event);
            }
          }
        } catch (error) {
          if (!opened) rejectOpened(error);
          else if (!controller.signal.aborted) throw error;
        }
      })().catch(() => {});
      return stream;
    },
    async terminate(signal = "SIGTERM") {
      for (const stream of streams) stream.close();
      if (child.exitCode == null) {
        child.kill(signal);
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error(`Conduit did not exit after ${signal}: ${output}`)),
            8_000,
          );
          child.once("exit", () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }
      return { exitCode: child.exitCode, output };
    },
    async stop() {
      await this.terminate();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
