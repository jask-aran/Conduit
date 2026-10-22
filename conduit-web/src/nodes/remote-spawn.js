import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { RemoteProcess } from "./remote-process.js";

/**
 * A harness process on a device, shaped as a child process for the harness's
 * own SDK (plan decision 5, remote spawn): main's adapter writes its stdin and
 * reads its stdout, the device runs it. It is returned at once, as a spawn
 * is; input written before the device has started it waits, in order.
 *
 * `harness` names what to run -- the device runs its own install -- and
 * `place` is where, `{ root, path }`. `env` holds only what the adapter adds;
 * this server's own environment is never sent.
 */
export function spawnOnDevice(hub, nodeId, { harness, args, place, env = {}, signal, onStderr }) {
  const events = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const state = { exitCode: null, signalCode: null, killed: false };
  const started = RemoteProcess.spawn(hub, nodeId, { harness, args, cwd: place, env });
  started.then((process) => {
    process.onData((text, stream) => {
      if (stream === "err") { onStderr?.(text); stderr.write(text); } else stdout.write(text);
    });
    process.onExit(({ exitCode, signal: ended }) => {
      // Exited reads as a code or a signal; a process the device lost has neither, so -1.
      Object.assign(state, { exitCode: exitCode ?? (ended ? null : -1), signalCode: ended || null });
      stdout.end();
      stderr.end();
      events.emit("exit", state.exitCode, state.signalCode);
    });
  }, (error) => {
    state.exitCode = 1;
    stdout.end();
    stderr.end();
    events.emit("error", error);
    events.emit("exit", 1, null);
  });
  const stdin = new Writable({
    write(chunk, _encoding, done) { started.then((process) => process.send(chunk)).then(() => done(), done); },
    final(done) { started.then((process) => process.closeInput()).then(() => done(), () => done()); },
  });
  const kill = (name = "SIGTERM") => {
    state.killed = true;
    started.then((process) => process.kill(name), () => {});
    return true;
  };
  signal?.addEventListener("abort", () => kill("SIGTERM"), { once: true });
  return {
    // No pid: it is the device's, and signalling it from here would signal a stranger.
    stdin, stdout, stderr, kill, pid: undefined,
    get killed() { return state.killed; },
    get exitCode() { return state.exitCode; },
    get signalCode() { return state.signalCode; },
    on: (event, listener) => { events.on(event, listener); },
    once: (event, listener) => { events.once(event, listener); },
    off: (event, listener) => { events.off(event, listener); },
  };
}

/**
 * What a harness's SDK asks to spawn, as the device should run it: the flags
 * after the executable (and a script path, when the SDK runs a bundled one
 * under its own runtime), and only the variables it added to this server's
 * environment.
 */
export function harnessLaunch({ args, env }) {
  const flag = args.findIndex((item) => String(item).startsWith("-"));
  return {
    args: flag < 0 ? [] : args.slice(flag),
    env: Object.fromEntries(Object.entries(env || {}).filter(([key, value]) => value !== undefined && process.env[key] !== value)),
  };
}

/**
 * A harness command run to completion on the device, as `execFile` would:
 * `{ stdout, stderr }`, or an error carrying them when it fails.
 */
export function execOnDevice(hub, nodeId, { harness, args, place, env = {}, timeout = 0 }) {
  return new Promise((resolve, reject) => {
    const child = spawnOnDevice(hub, nodeId, { harness, args, place, env });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.stdin.end();
    const timer = timeout ? setTimeout(() => child.kill("SIGTERM"), timeout) : null;
    let failed = null;
    child.on("error", (error) => { failed = error; });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      // Let the streams hand over their last chunks.
      setImmediate(() => {
        if (!failed && code === 0) return resolve({ stdout, stderr });
        reject(Object.assign(failed || new Error(stderr.trim() || `${harness} exited (${signal || code})`), { stdout, stderr, code }));
      });
    });
  });
}

/** Refuse a device chat whose device is away or lacks the harness, before anything starts. */
export function requireHarnessOn(hub, nodeId, harness, label) {
  if (hub?.live.get(nodeId)?.harnesses?.includes(harness)) return;
  throw Object.assign(new Error(`${label} is not available on that device: it is offline, or ${label} is not installed there`),
    { code: "harness_unavailable_on_device", status: 409 });
}

/** What a chat keeps of a harness session: its id, and for one on a device, which device -- it is found there. */
export const opaqueSessionOf = (record) => (record.nodeId ? { threadId: record.sessionId, nodeId: record.nodeId } : record.sessionId);
