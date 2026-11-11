import { execFile as execFileCallback, spawn as spawnLocal } from "node:child_process";
import net from "node:net";
import { promisify } from "node:util";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { claudeSession, codexRollout, opencodeService, tunnelTarget } from "./node-harnesses.js";
import { execOnDevice, harnessLaunch, requireHarnessOn, spawnOnDevice } from "./remote-spawn.js";
import { fetchOnDevice, tunnelTo } from "./remote-tunnel.js";
import { RemoteExecutionEnv } from "./remote-env.js";
import { RemoteProcess } from "./remote-process.js";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";

const execFileLocal = promisify(execFileCallback);

// What a harness saved on a device, read there; here, the same functions run in process.
const HARNESS_READS = { claudeSession, codexRollout, opencodeService };

/** The same methods whether the place is this server's own folder or a device's, so an adapter never branches on where. */
export function placeProcesses(hub, { nodeId = null, place = null } = {}) {
  if (!nodeId) {
    return {
      local: true, nodeId: null, place: null,
      spawn: (_harness, command, args = [], options = {}) => spawnLocal(command, args, options),
      execFile: (_harness, command, args = [], options = {}) => execFileLocal(command, args, { encoding: "utf8", ...options }),
      sdkSpawn: null,
      connect: (endpoint) => net.connect(endpoint.path ? { path: endpoint.path } : tunnelTarget(endpoint)),
      fetch: (url, init) => fetch(url, init),
      read: async (method, ...args) => (HARNESS_READS[method] ? HARNESS_READS[method](...args) : null),
      ready: () => true,
      require: () => {},
      env: ({ cwd, shellEnv, shellSettings = {} }) => {
        const shellPath = typeof shellSettings.shellPath === "string" && shellSettings.shellPath.trim() ? shellSettings.shellPath : undefined;
        const prefix = typeof shellSettings.shellCommandPrefix === "string" ? shellSettings.shellCommandPrefix : "";
        const env = new NodeExecutionEnv({ cwd: cwd || process.cwd(), shellEnv, shellPath });
        const exec = env.exec.bind(env);
        env.exec = (command, options, context) => exec(typeof command === "string" && prefix ? `${prefix}\n${command}` : command, options, context);
        return env;
      },
      shells: null,
    };
  }
  const added = (env) => Object.fromEntries(Object.entries(env || {})
    .filter(([key, value]) => value !== undefined && process.env[key] !== value));
  return {
    local: false, nodeId, place,
    spawn: (harness, _command, args = [], options = {}) => spawnOnDevice(hub, nodeId,
      { harness, args, place, env: added(options.env), signal: options.signal }),
    execFile: (harness, _command, args = [], options = {}) => execOnDevice(hub, nodeId,
      { harness, args, place, env: added(options.env), timeout: options.timeout || 0 }),
    sdkSpawn: (harness, onStderr) => (spawn) => spawnOnDevice(hub, nodeId,
      { harness, ...harnessLaunch(spawn), place, signal: spawn.signal, onStderr }),
    // A device's own harness socket is found there: only the endpoint's name travels.
    connect: (endpoint) => tunnelTo(hub, nodeId, endpoint.harness ? { harness: endpoint.harness } : endpoint),
    fetch: (url, init) => fetchOnDevice(hub, nodeId, url, init),
    // Null while the device is away, as a missing file reads here.
    read: async (method, ...args) => {
      if (!hub?.live.get(nodeId)?.ready) return null;
      const result = await hub.call(nodeId, { target: "harness", method, args, cwd: null },
        withAbortSignal(AbortSignal.timeout(20_000), BACKGROUND_CONTEXT)).catch(() => null);
      return result?.ok ? result.value : null;
    },
    ready: () => Boolean(hub?.live.get(nodeId)?.ready),
    require: (harness, label) => requireHarnessOn(hub, nodeId, harness, label),
    env: ({ cwd, onWait, excuse }) => new RemoteExecutionEnv({ hub, nodeId, place, cwd, onWait, excuse }),
    shells: {
      start: ({ cols, rows }) => RemoteProcess.spawn(hub, nodeId, { shell: true, cwd: place, pty: { cols, rows } }),
      reattach: (procId, options) => RemoteProcess.reattach(hub, nodeId, procId, options),
      kill(procId) {
        if (!hub?.live.get(nodeId)?.ready) return void hub?.killLater(nodeId, procId);
        const shell = new RemoteProcess(hub, nodeId, { id: procId });
        // A kill that did not reach the device (it reads ready until a missed pong says otherwise) is kept for its
        // next hello, as one asked while it is away is.
        void shell.kill().then((error) => { if (error && !/No such process/.test(error.message || "")) return hub.killLater(nodeId, procId); });
        hub.unfollow(shell);
      },
    },
  };
}
