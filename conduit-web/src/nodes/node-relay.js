import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";

/*
 * A relayed node keeps its own key, and main checks it as it would a direct connection. The relay is still trusted:
 * the key passes through it, but it is the same machine and user, which can read that key on disk anyway.
 */

const RESPAWN_MS = [1000, 5000, 30000];
// An open main has not answered by then is given up, and the child dials again.
const OPEN_WAIT_MS = 30_000;

/** Run as a child for as long as the relay runs: its processes are the environment's, and outlive any one socket. */
export function relayEnvironment({ env, command, log = console }) {
  let child = null;
  let up = null;
  let confidential = false;
  let wantsOpen = null;
  let opening = null;
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

/** Liveness is the relay's to watch, so a ping is answered here. */
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
