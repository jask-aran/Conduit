import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";

/*
 * Environments relayed over one device's connection (plan decision 25).
 *
 * A device's daemon (Windows) can carry another environment's node (a WSL
 * distro) on its own socket to main, instead of that node dialling main
 * itself. The relayed node runs as a child -- `conduit-node run --stdio` --
 * and speaks the node protocol unchanged over stdin/stdout, one JSON line per
 * frame. It keeps its own key and its own node id: the relay forwards its
 * hello and calls untouched and main checks its key as it would a direct
 * connection, so the relay can never speak for it. Which way an environment
 * connects is its own setting (`conduit-node relayed on|off`).
 *
 * The relay is trusted (decision 25): the relayed node's key passes through
 * it, so it could speak for that node. It is the same machine and user,
 * which can read that key on disk anyway.
 *
 * The child lines:
 *   child -> relay  { t: "open", key }   dial main (once per connection)
 *                   { t: "msg", d }      a frame for main
 *                   { t: "pong" }        answer to a ping
 *                   { t: "close" }       hang up
 *   relay -> child  { t: "opened", confidential }
 *                                        main took the key; whether the relay's
 *                                        own link to main is one nobody else
 *                                        reads (https, loopback), which the
 *                                        child cannot see and takes its word for
 *                   { t: "msg", d }      a frame from main
 *                   { t: "ping" }        main checking the child itself is alive
 *                   { t: "closed", reason }
 *
 * On the relay's socket to main the same, tagged by the environment:
 *   { type: "relay-open", env, key } / { type: "relay", env, d } / { type: "relay-pong", env } / { type: "relay-close", env }
 *   and from main { type: "relay-opened", env } / { type: "relay", env, d } / { type: "relay-ping", env } / { type: "relay-closed", env, reason }.
 */

const RESPAWN_MS = [1000, 5000, 30000];
// An open main has not answered by then is given up, and the child dials again.
const OPEN_WAIT_MS = 30_000;

/**
 * The relay's side: one environment, run as a child for as long as the relay
 * runs (its processes are the environment's, and outlive any one socket).
 * `attach(send)` when the relay's socket to main is up, `detach()` when it
 * drops; `deliver(frame)` for main's frames tagged with this environment.
 */
export function relayEnvironment({ env, command, log = console }) {
  let child = null;
  let up = null; // send to main, while the relay's socket is up
  let confidential = false; // whether that socket is one nobody else reads
  let wantsOpen = null; // the child's dial, waiting for the relay's socket
  let opening = null; // sent to main, not yet answered: its give-up timer
  let open = false;
  let respawns = 0;
  let timer = null;
  let stopped = false;

  const down = (line) => { if (child?.stdin.writable) child.stdin.write(`${JSON.stringify(line)}\n`); };
  const dial = () => {
    if (!wantsOpen || !up) return;
    up({ type: "relay-open", env, key: wantsOpen.key });
    wantsOpen = null;
    opening = setTimeout(() => { opening = null; down({ t: "closed", reason: "main did not answer" }); }, OPEN_WAIT_MS);
    opening.unref?.();
  };
  // A dial in flight or open is ended for the child, which dials again.
  const hangUp = (reason) => {
    if (opening) { clearTimeout(opening); opening = null; down({ t: "closed", reason }); }
    else if (open) { open = false; down({ t: "closed", reason }); }
  };

  const start = () => {
    const [file, ...args] = command;
    const started = Date.now();
    child = spawn(file, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    child.stderr.on("data", (chunk) => log.info?.(`[${env}] ${String(chunk).trimEnd()}`));
    readline.createInterface({ input: child.stdout }).on("line", (raw) => {
      let line;
      try { line = JSON.parse(raw); } catch { return; }
      if (line.t === "open") { wantsOpen = { key: String(line.key || "") }; dial(); }
      else if (line.t === "msg" && open) up?.({ type: "relay", env, d: line.d });
      else if (line.t === "pong" && open) up?.({ type: "relay-pong", env });
      else if (line.t === "close" && open) { open = false; up?.({ type: "relay-close", env }); }
    });
    child.on("error", (error) => log.warn?.(`[conduit-node] ${env}: ${error.message}`));
    child.on("exit", (code) => {
      child = null;
      wantsOpen = null;
      clearTimeout(opening);
      opening = null;
      if (open) { open = false; up?.({ type: "relay-close", env }); }
      if (stopped) return;
      if (Date.now() - started > 60_000) respawns = 0;
      const wait = RESPAWN_MS[Math.min(respawns++, RESPAWN_MS.length - 1)];
      log.warn?.(`[conduit-node] ${env} exited (${code}); starting it again in ${wait / 1000}s`);
      timer = setTimeout(start, wait);
    });
  };
  start();

  return {
    env,
    attach(send, link = {}) { up = send; confidential = link.confidential === true; dial(); },
    detach() {
      up = null;
      hangUp("relay disconnected");
    },
    deliver(message) {
      if (message.type === "relay-opened") {
        if (!opening) return;
        clearTimeout(opening);
        opening = null;
        open = true;
        down({ t: "opened", confidential });
      } else if (message.type === "relay-closed") hangUp(message.reason || "closed");
      else if (message.type === "relay" && open) down({ t: "msg", d: message.d });
      else if (message.type === "relay-ping" && open) down({ t: "ping" });
    },
    stop() { stopped = true; clearTimeout(timer); child?.kill(); },
  };
}

/**
 * The relayed node's side: a socket to main, shaped as the agent uses a
 * WebSocket, over this process's stdin/stdout to its relay. Liveness is the
 * relay's to watch (its own socket's heartbeat), so a ping is answered here.
 */
export function stdioDialer({ input = process.stdin, output = process.stdout } = {}) {
  let current = null;
  readline.createInterface({ input }).on("line", (raw) => {
    let line;
    try { line = JSON.parse(raw); } catch { return; }
    if (!current) return;
    if (line.t === "opened") { current.readyState = 1; current.confidential = line.confidential === true; current.emit("open"); }
    else if (line.t === "msg") current.emit("message", line.d);
    // Answered by this process's own loop: one that hangs does not answer.
    else if (line.t === "ping") write({ t: "pong" });
    else if (line.t === "closed") current.end();
  });
  // The relay went away: nothing can reach main from here.
  input.on("end", () => process.exit(0));
  const write = (line) => output.write(`${JSON.stringify(line)}\n`);

  return (_url, { key }) => {
    current?.end();
    const socket = new EventEmitter();
    socket.readyState = 0;
    socket.send = (data) => { if (socket.readyState === 1) write({ t: "msg", d: String(data) }); };
    socket.ping = () => queueMicrotask(() => socket.emit("pong"));
    socket.end = () => {
      if (socket.readyState === 3) return;
      socket.readyState = 3;
      if (current === socket) current = null;
      socket.emit("close");
    };
    socket.close = () => { if (socket.readyState !== 3) { write({ t: "close" }); socket.end(); } };
    socket.terminate = socket.close;
    current = socket;
    write({ t: "open", key });
    return socket;
  };
}
