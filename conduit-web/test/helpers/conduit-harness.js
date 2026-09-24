import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";


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
if (process.argv.includes("--version")) { console.log("0.84.1"); process.exit(0); }
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
  // Pi answers transcript reads itself, and the prompt path waits on one before
  // it sends anything. Tests drive the interesting exchanges through the event
  // log; answering this one here keeps them from stalling behind it.
  if (command.id && command.type === "get_entries") {
    process.stdout.write(JSON.stringify({
      id: command.id, type: "response", command: "get_entries", success: true, data: { entries: [], leafId: null },
    }) + "\\n");
  }
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
  return { conduitPi };
}

async function writeFakeCodex(root, wsModulePath) {
  const command = path.join(root, "codex");
  await fs.writeFile(command, `#!/usr/bin/env node
if (process.argv.includes("--version")) { console.log("codex-cli 0.test"); process.exit(0); }
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { WebSocketServer } = require(${JSON.stringify(wsModulePath)});

const controlDirectory = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "app-server-control");
const socketPath = path.join(controlDirectory, "app-server-control.sock");
const pidFile = path.join(controlDirectory, "daemon.pid");

let turnCount = 0;
let steerCount = 0;

/** The text of a turn's input items, which is what a userMessage echoes back. */
function inputText(input) {
  return (Array.isArray(input) ? input : []).filter((item) => item && item.type === "text")
    .map((item) => item.text || "").join("\\n").trim();
}

function handle(message, send) {
  if (message.method === "initialize") return send({ id: message.id, result: { userAgent: "conduit-test" } });
  if (message.method === "initialized") return;
  if (message.method === "thread/start" || message.method === "thread/resume") {
    const id = message.params.threadId || "thread-test";
    const model = message.params.model || "codex-test";
    const reasoningEffort = message.params.effort || "medium";
    send({ id: message.id, result: { thread: { id, model, reasoningEffort, turns: [] }, model } });
    return;
  }
  if (message.method === "thread/read") return send({ id: message.id, result: { thread: { id: message.params.threadId, turns: [] } } });
  if (message.method === "thread/list") {
    const elsewhere = process.env.CONDUIT_TEST_ELSEWHERE || os.tmpdir();
    // The workspace thread echoes the requested cwd so workspace-scoped lookups
    // find it, except when the request is scoped to the unrelated folder.
    const workspace = message.params.cwd && message.params.cwd !== elsewhere ? message.params.cwd : process.cwd();
    const threads = [
      { id: "foreign-thread", name: "Foreign thread", preview: "Existing Codex work", cwd: workspace, createdAt: 1, updatedAt: 2, status: { type: "idle" }, source: "vscode", gitInfo: { branch: "main" } },
      { id: "elsewhere-thread", name: "Elsewhere thread", preview: "Work in another folder", cwd: elsewhere, createdAt: 3, updatedAt: 4, status: { type: "idle" }, source: "cli" },
    ];
    // Codex filters by cwd server-side; machine-wide listing omits the param.
    return send({ id: message.id, result: { data: message.params.cwd ? threads.filter((thread) => thread.cwd === message.params.cwd) : threads } });
  }
  if (message.method === "model/list") return send({ id: message.id, result: { data: [
    { id: "codex-test", displayName: "Codex Test", hidden: false, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }, { reasoningEffort: "high" }] },
    { id: "codex-other", displayName: "Codex Other", hidden: false, defaultReasoningEffort: "low", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }] },
  ] } });
  if (message.method === "turn/start") {
    const answer = [message.params.model, message.params.effort, "works"].filter(Boolean).join(" ");
    const turnId = "turn-" + (++turnCount);
    send({ method: "turn/started", params: { turn: { id: turnId } } });
    send({ id: message.id, result: { turn: { id: turnId } } });
    // The prompt Conduit named, echoed back the way the app-server echoes it.
    send({ method: "item/started", params: { turnId, item: { id: "item-user-" + turnCount,
      clientId: message.params.clientUserMessageId, type: "userMessage",
      content: [{ type: "text", text: inputText(message.params.input) }] } } });
    // A full turn: it says what it is about to do, runs a command, and answers.
    // A prompt that asks for the short version gets only the answer, so a test
    // can choose which shape it is driving.
    if (!/^short/.test(inputText(message.params.input))) {
      send({ method: "item/agentMessage/delta", params: { turnId, itemId: "commentary-" + turnCount, delta: "Looking now." } });
      send({ method: "item/completed", params: { turnId, item: { id: "commentary-" + turnCount,
        type: "agentMessage", text: "Looking now.", phase: "commentary" } } });
      send({ method: "item/started", params: { turnId, item: { id: "command-" + turnCount, type: "commandExecution", command: "echo hello" } } });
      send({ method: "item/completed", params: { turnId, item: { id: "command-" + turnCount,
        type: "commandExecution", command: "echo hello", aggregatedOutput: "hello", status: "completed" } } });
    }
    send({ method: "item/agentMessage/delta", params: { turnId, itemId: "message-" + turnCount, delta: answer } });
    send({ method: "item/completed", params: { turnId, item: { id: "message-" + turnCount,
      type: "agentMessage", text: answer, phase: "final_answer" } } });
    send({ method: "turn/completed", params: { turn: { id: turnId, status: "completed" } } });
    return;
  }
  if (message.method === "turn/steer") {
    const turnId = message.params.expectedTurnId;
    send({ id: message.id, result: {} });
    send({ method: "item/started", params: { turnId, item: { id: "item-steer-" + (++steerCount),
      clientId: message.params.clientUserMessageId, type: "userMessage",
      content: [{ type: "text", text: inputText(message.params.input) }] } } });
    return;
  }
  if (message.method === "turn/interrupt") return send({ id: message.id, result: {} });
  // A real server always answers. Dropping an unmodelled request would stall
  // the caller for its full 15s timeout instead of failing a test outright.
  if (message.id != null) return send({ id: message.id, result: {} });
}

// Conduit talks to Codex over the daemon's control socket, so the fake has to
// be daemon-shaped too: \`daemon start\` detaches a server and returns, and the
// server answers JSON-RPC over one WebSocket per connection.
function serve() {
  fs.mkdirSync(controlDirectory, { recursive: true });
  try { fs.unlinkSync(socketPath); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const server = http.createServer();
  const sockets = new WebSocketServer({ server });
  sockets.on("connection", (socket) => {
    socket.on("message", (data) => {
      let message;
      try { message = JSON.parse(String(data)); } catch { return; }
      handle(message, (reply) => { if (socket.readyState === 1) socket.send(JSON.stringify(reply)); });
    });
  });
  const shutdown = () => {
    try { fs.unlinkSync(socketPath); } catch {}
    try { fs.unlinkSync(pidFile); } catch {}
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  server.listen(socketPath, () => fs.writeFileSync(pidFile, String(process.pid)));
}

function reachable() {
  return new Promise((resolve) => {
    const probe = net.connect(socketPath);
    probe.once("connect", () => { probe.destroy(); resolve(true); });
    probe.once("error", () => resolve(false));
  });
}

async function daemonStart() {
  if (await reachable()) return;
  const child = spawn(process.execPath, [__filename, "--serve"], { detached: true, stdio: "ignore" });
  child.unref();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await reachable()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("fake Codex daemon did not start");
}

if (process.argv.includes("--serve")) serve();
else if (process.argv.includes("daemon") && process.argv.includes("start")) {
  daemonStart().then(() => process.exit(0), (error) => { console.error(error.message); process.exit(1); });
}
`);
  await fs.chmod(command, 0o755);
  return command;
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
  const commandLog = path.join(root, "pi-commands.jsonl");
  const eventLog = path.join(root, "pi-events.jsonl");
  const { conduitPi } = await writeFakePi(root);
  const codexCommand = await writeFakeCodex(root, createRequire(import.meta.url).resolve("ws"));
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: path.resolve(import.meta.dirname, "../.."),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HOME: root,
      CODEX_HOME: path.join(root, ".codex"),
      CONDUIT_HOST: "127.0.0.1",
      // The server binds a free port and tells us which. Picking one here meant
      // probing for a free port, closing the probe, and handing the number to a
      // child that took a second to start: anything else listening on 0 in that
      // window could be given the same port, and test files run side by side.
      CONDUIT_PORT: "0",
      // Tests do not announce themselves to the network the machine is on:
      // a dozen harness servers publishing the same instance name would be
      // renamed past each other, and none of it is what is under test.
      CONDUIT_ADVERTISE_ON_LAN: "false",
      CONDUIT_FILES_ROOT: path.join(root, "files"),
      CONDUIT_CATALOG_FILE: path.join(root, "conduit.json"),
      CONDUIT_SESSION_REGISTRY_FILE: path.join(root, "sessions.json"),
      CONDUIT_PREFERENCES_FILE: path.join(root, "preferences.json"),
      CONDUIT_AUTH_FILE: path.join(root, "auth.json"),
      CONDUIT_REMOTES_FILE: path.join(root, "remotes.json"),
      CONDUIT_TERMINAL_TEARDOWN: "1",
      CONDUIT_VOICE_CONFIG_FILE: path.join(root, "voice.json"),
      CONDUIT_VOICE_MODEL_ROOT: path.join(root, "voice-models"),
      CONDUIT_VOICE_RECORDINGS_ROOT: path.join(root, "voice-recordings"),
      CONDUIT_PI_AGENT_DIR: path.join(root, "pi"),
      CONDUIT_PI_COMMAND: conduitPi,
      CONDUIT_CODEX_COMMAND: codexCommand,
      CONDUIT_WORKSPACE_ALLOWLIST: root,
      TEST_PI_COMMAND_LOG: commandLog,
      TEST_PI_EVENT_LOG: eventLog,
      ...env,
    },
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  let origin = "";
  try {
    await waitFor(() => {
      if (child.exitCode != null) throw new Error(`Conduit server exited with ${child.exitCode}: ${output}`);
      const listening = output.match(/listening on (http:\/\/\S+)/);
      if (listening) origin = listening[1];
      return Boolean(origin);
    }, "Conduit server did not report a port");
    await waitFor(async () => {
      if (child.exitCode != null) throw new Error(`Conduit server exited with ${child.exitCode}: ${output}`);
      try {
        const response = await fetch(`${origin}/healthz`);
        // Confirm this is our server and not merely something answering on the
        // port. A stray listener that says 200 to everything would otherwise
        // pass for ready, and every later request would go to it instead.
        return response.ok && (await response.json())?.status === "ready";
      } catch { return false; }
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
        if (event.type === "assistant_content" && event.phase === "delta") {
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
      // The fake Codex daemon is detached, so it outlives the server it served.
      const pid = Number(await fs.readFile(path.join(root, ".codex", "app-server-control", "daemon.pid"), "utf8").catch(() => ""));
      if (pid) { try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ } }
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
