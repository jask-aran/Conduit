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

/**
 * How an adapter runs a harness in one place (decision 24: the head is a
 * device like the others). The same methods whether the place is this
 * server's own folder or a device's, so an adapter never branches on where:
 *
 * - `spawn` / `execFile`: the harness's process, with Node's shapes. On a
 *   device the device runs its own install of `harness`, and only the
 *   variables the adapter added to this server's environment go along.
 * - `sdkSpawn`: what to hand an SDK that spawns its own process (Claude
 *   Code's `spawnClaudeCodeProcess`): `null` here, where the SDK spawns as it
 *   would anyway.
 * - `connect` / `fetch`: a harness's local service, by endpoint
 *   (`{ harness: "codex" }`, `{ port }`) or URL.
 * - `read`: what the harness saved (a session file, a rollout, a service's
 *   state), by the node's own readers (node-harnesses.js), run where it is.
 * - `require`: refuse at once when the place cannot run the harness.
 * - `shells` (a device's only): interactive shells the device keeps, across
 *   disconnects and this server's restarts -- started in the place (or, with
 *   `{ home: true }`, the device's home where its owner allows), followed
 *   again later, killed (when the device is next back, if it is away). This
 *   server's own shells are tmux sessions (pty-manager.js), which outlive it
 *   the same way.
 * - `env`: the durable agent's execution environment (files, shell) in a
 *   folder of the place: this machine's disk, or the device's node. `cwd` is
 *   how the folder reads; on a device the place is what is sent.
 *
 * `place` is `{ nodeId, place }` as a project or record carries them; no
 * node id is this server.
 */
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
      env: ({ cwd, shellEnv }) => new NodeExecutionEnv({ cwd: cwd || process.cwd(), shellEnv }),
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
        shell.kill();
        hub.unfollow(shell);
      },
    },
  };
}
