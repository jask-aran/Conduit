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
  const state = { exitCode: null, signalCode: null, killed: false };
  const started = RemoteProcess.spawn(hub, nodeId, { harness, args, cwd: place, env });
  started.then((process) => {
    process.onData((text, stream) => { if (stream === "err") onStderr?.(text); else stdout.write(text); });
    process.onExit(({ exitCode, signal: ended }) => {
      Object.assign(state, { exitCode: exitCode ?? null, signalCode: ended || null });
      stdout.end();
      events.emit("exit", state.exitCode, state.signalCode);
    });
  }, (error) => {
    stdout.end();
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
    stdin, stdout, kill,
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
