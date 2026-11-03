import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startNodeAgent } from "../../src/nodes/node-agent.js";

// Only the transport is fake. Calls and process events use the real node agent.
export async function nodeFixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-nodes-"));
  await fs.symlink(process.execPath, path.join(root, "claude"));
  const values = { PATH: root, CONDUIT_DATA_ROOT: root, CONDUIT_NODE_HOME: root, CONDUIT_ADVERTISE_ON_LAN: "false", CONDUIT_PORT: "0", CONDUIT_TMUX_PATH: path.join(root, "no-tmux") };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  const socket = new EventEmitter();
  socket.readyState = 1;
  socket.ping = () => socket.emit("pong");
  socket.close = () => { socket.readyState = 3; socket.emit("close", 1000); };
  socket.terminate = socket.close;
  const messages = new EventEmitter();
  socket.send = (raw) => messages.emit("message", JSON.parse(raw));
  const send = (message) => socket.emit("message", JSON.stringify(message));
  const pending = new Map();
  const followers = new Map();
  let serial = 0;
  messages.on("message", (message) => {
    if (message.type === "proc") followers.get(message.proc)?.deliver(message);
    if (message.type === "result") { pending.get(message.id)?.resolve(message.value); pending.delete(message.id); }
    if (message.type === "failure") { pending.get(message.id)?.reject(new Error(message.message)); pending.delete(message.id); }
  });
  const hub = {
    live: new Map([["fixture-node", { ready: true }]]),
    follow: (process) => followers.set(process.procId, process),
    unfollow: (process) => followers.delete(process.procId),
    call(_nodeId, spec) {
      const id = String(++serial);
      const result = Promise.withResolvers();
      pending.set(id, result);
      send({ type: "call", id, ...spec });
      return result.promise;
    },
  };
  const agent = startNodeAgent({ mainUrl: "http://127.0.0.1:1", key: "fixture-key", name: "fixture-node",
    roots: [{ id: "fixture-root", path: root, read: true, shell: true }], shellEnv: {}, log: {},
    dial: () => socket, ...options });
  t.after(async () => {
    agent.stop();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, socket, send, messages, hub, place: { root: "fixture-root", path: "." } };
}
