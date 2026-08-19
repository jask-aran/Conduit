import fs from "node:fs/promises";

const root = new URL("../", import.meta.url);
async function read(path) { return fs.readFile(new URL(path, root), "utf8"); }
async function write(path, content) { await fs.writeFile(new URL(path, root), content, "utf8"); }
function replaceOnce(content, before, after, label) {
  const first = content.indexOf(before);
  if (first < 0) throw new Error(`Missing replacement anchor: ${label}`);
  if (content.indexOf(before, first + before.length) >= 0) throw new Error(`Replacement anchor is not unique: ${label}`);
  return content.slice(0, first) + after + content.slice(first + before.length);
}

{
  const path = "conduit-web/src/client/remotes/terminal-pane.tsx";
  let content = await read(path);
  content = replaceOnce(
    content,
    `    const finishReplay = () => {
      if (generation !== connectionGeneration) return;
      replaying = false;
      activeTerminal.repaint();
      if (host) host.dataset.terminalReady = "true";
      setConnectionState("attached");
      sendResize();
      focusActiveTerminal();
    };`,
    `    const finishReplay = () => {
      if (generation !== connectionGeneration || connection.readyState !== WebSocket.OPEN) return;
      // Keep browser-generated terminal replies suppressed until the server has
      // drained every output mutation that the headless emulator already saw.
      activeTerminal.repaint();
      connection.send(JSON.stringify({ type: "restore_ready" }));
    };`,
    "client restore acknowledgement",
  );
  content = replaceOnce(
    content,
    `          if (message.type === "control") {
            setWritable(message.writable === true);
            if (message.writable !== true) setTerminalFocused(false);
            if (message.writable === true) {
              setConnectionState("attached");
              sendResize();
              focusActiveTerminal();
            }
            return;
          }`,
    `          if (message.type === "control") {
            // A control frame is only sent after this client's restore/catch-up
            // handshake is complete. From this point on, live browser output may
            // answer terminal protocol queries when this client owns control.
            replaying = false;
            setWritable(message.writable === true);
            if (host) host.dataset.terminalReady = "true";
            setConnectionState("attached");
            if (message.writable !== true) setTerminalFocused(false);
            if (message.writable === true) {
              sendResize();
              focusActiveTerminal();
            }
            return;
          }`,
    "control completes restore",
  );
  await write(path, content);
}

await write("conduit-web/src/server/terminal-stream.js", `import { PtyOutputBatcher } from "../pty-output-batcher.js";

const TERMINAL_PENDING_LIMIT = 1024 * 1024;

export function createTerminalStream({ terminals, wss }) {
  const terminalClients = new Map();
  const terminalControllers = new Map();

  const syncProtocolResponder = (id) => {
    const controller = terminalControllers.get(id) || null;
    const browserOwnsProtocol = Boolean(
      controller
      && controller.readyState === controller.OPEN
      && controller.conduitTerminalRestoring !== true
    );
    terminals.setProtocolResponder?.(id, !browserOwnsProtocol);
  };

  const sendTerminalControl = (id) => {
    const controller = terminalControllers.get(id) || null;
    for (const ws of terminalClients.get(id) || []) {
      if (ws.readyState !== ws.OPEN || ws.conduitTerminalRestoring) continue;
      ws.send(JSON.stringify({ type: "control", writable: ws === controller }));
    }
  };

  const promoteTerminalController = (id) => {
    if (!terminalControllers.has(id)) {
      const record = terminals.get(id);
      if (record?.status === "running") {
        const next = [...(terminalClients.get(id) || [])].find((ws) => ws.readyState === ws.OPEN);
        if (next) terminalControllers.set(id, next);
      }
    }
    syncProtocolResponder(id);
    sendTerminalControl(id);
  };

  const detachTerminalClient = (id, ws) => {
    const clients = terminalClients.get(id);
    if (!clients) return;
    clients.delete(ws);
    ws.conduitTerminalPending = [];
    ws.conduitTerminalPendingBytes = 0;
    if (terminalControllers.get(id) === ws) terminalControllers.delete(id);
    if (!clients.size) {
      terminalClients.delete(id);
      terminalControllers.delete(id);
      terminals.setProtocolResponder?.(id, true);
      return;
    }
    promoteTerminalController(id);
  };

  const queuePending = (ws, event) => {
    const size = event.type === "data" ? event.bytes.length : 32;
    ws.conduitTerminalPending.push(event);
    ws.conduitTerminalPendingBytes += size;
    if (ws.conduitTerminalPendingBytes > TERMINAL_PENDING_LIMIT) ws.close(1013, "Terminal client is too slow");
  };

  const sendOutput = (ws, bytes) => {
    if (ws.bufferedAmount > TERMINAL_PENDING_LIMIT) {
      ws.close(1013, "Terminal client is too slow");
      return;
    }
    ws.send(bytes, { binary: true });
  };

  const sendRestoreEvent = (ws, event) => {
    if (event.type === "resize") ws.send(JSON.stringify({ type: "replay_resize", cols: event.cols, rows: event.rows }));
    else sendOutput(ws, event.bytes);
  };

  const finishRestoreRound = (id, ws) => {
    if (ws.readyState !== ws.OPEN || !ws.conduitTerminalRestoring) return;
    const pending = ws.conduitTerminalPending;
    ws.conduitTerminalPending = [];
    ws.conduitTerminalPendingBytes = 0;
    if (pending.length) {
      // The headless emulator already answered protocol queries represented by
      // these bytes. Send another catch-up round while browser replies remain
      // suppressed, then wait for another acknowledgement.
      for (const event of pending) sendRestoreEvent(ws, event);
      ws.send(JSON.stringify({ type: "replay_end" }));
      return;
    }

    // Empty pending queue is the atomic ownership cut: all prior PTY output was
    // consumed by headless state, and all subsequent output belongs to the
    // browser controller (if this client is the controller).
    ws.conduitTerminalRestoring = false;
    syncProtocolResponder(id);
    sendTerminalControl(id);
  };

  const terminalOutput = new PtyOutputBatcher((id, bytes) => {
    for (const ws of terminalClients.get(id) || []) {
      if (ws.readyState !== ws.OPEN || ws.conduitTerminalRestoring) continue;
      sendOutput(ws, bytes);
    }
  });

  terminals.on("output", ({ id, bytes, sequence }) => {
    for (const ws of terminalClients.get(id) || []) {
      if (ws.readyState === ws.OPEN && ws.conduitTerminalRestoring) {
        queuePending(ws, { type: "data", bytes: Buffer.from(bytes), sequence });
      }
    }
    terminalOutput.append(id, bytes);
  });
  terminals.on("resize", ({ id, cols, rows, sequence }) => {
    for (const ws of terminalClients.get(id) || []) {
      if (ws.readyState !== ws.OPEN) continue;
      if (ws.conduitTerminalRestoring) queuePending(ws, { type: "resize", cols, rows, sequence });
      else ws.send(JSON.stringify({ type: "remote_resize", cols, rows }));
    }
  });
  terminals.on("exit", (record) => {
    terminalOutput.flush(record.id);
    terminalControllers.delete(record.id);
    for (const ws of terminalClients.get(record.id) || []) {
      if (ws.readyState !== ws.OPEN) continue;
      ws.send(JSON.stringify({ type: "status", status: "exited", exitCode: record.exitCode, signal: record.signal }));
      if (!ws.conduitTerminalRestoring) ws.send(JSON.stringify({ type: "control", writable: false }));
    }
  });
  terminals.on("removed", ({ id }) => {
    terminalOutput.flush(id);
    terminalControllers.delete(id);
    for (const ws of terminalClients.get(id) || []) {
      if (ws.readyState === ws.OPEN) ws.close(1001, "Terminal was removed");
    }
    terminalClients.delete(id);
  });

  const handleUpgrade = (id, request, socket, head) => wss.handleUpgrade(request, socket, head, (ws) => {
    terminalOutput.flush(id);
    ws.conduitTerminalRestoring = true;
    ws.conduitTerminalPending = [];
    ws.conduitTerminalPendingBytes = 0;

    const clients = terminalClients.get(id) || new Set();
    clients.add(ws);
    terminalClients.set(id, clients);
    const record = terminals.get(id);
    if (record.status === "running" && !terminalControllers.has(id)) terminalControllers.set(id, ws);
    syncProtocolResponder(id);

    ws.on("message", (data, isBinary) => {
      try {
        if (!isBinary) {
          const command = JSON.parse(String(data));
          if (command.type === "restore_ready") {
            finishRestoreRound(id, ws);
            return;
          }
        }
        if (terminalControllers.get(id) !== ws) {
          throw Object.assign(new Error("Another attached browser currently controls this terminal"), { code: "pty_read_only" });
        }
        if (ws.conduitTerminalRestoring) {
          throw Object.assign(new Error("Terminal state is still restoring"), { code: "pty_not_ready" });
        }
        if (isBinary) {
          terminalOutput.flush(id);
          terminals.input(id, data);
        } else {
          const command = JSON.parse(String(data));
          if (command.type === "resize") terminals.resize(id, command.cols, command.rows);
          else throw Object.assign(new Error("Unknown terminal control frame"), { code: "pty_control_invalid" });
        }
      } catch (error) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "client_error", code: error.code, message: error.message }));
      }
    });
    ws.on("close", () => detachTerminalClient(id, ws));

    void (async () => {
      let replay;
      try {
        replay = record.status === "running" ? await terminals.stateReplay(id) : terminals.replay(id);
      } catch {
        replay = terminals.replay(id);
      }
      if (ws.readyState !== ws.OPEN) return;

      terminalOutput.flush(id);
      const boundary = replay.sequence || 0;
      const pending = ws.conduitTerminalPending.filter((event) => event.sequence > boundary);
      ws.conduitTerminalPending = [];
      ws.conduitTerminalPendingBytes = 0;

      ws.send(JSON.stringify({ type: "replay_start", complete: replay.complete, source: replay.source || "journal" }));
      if (replay.bytes.length) ws.send(replay.bytes, { binary: true });
      for (const event of pending) sendRestoreEvent(ws, event);
      ws.send(JSON.stringify({ type: "replay_end" }));
      ws.send(JSON.stringify({ type: "status", status: record.status, exitCode: record.exitCode, signal: record.signal }));
      // Do not hand off terminal protocol ownership here. The browser acks only
      // after it has applied this replay, and catch-up repeats until the pending
      // queue is empty at an acknowledgement boundary.
    })().catch(() => {
      if (ws.readyState === ws.OPEN) ws.close(1011, "Terminal state restoration failed");
    });
  });

  return { handleUpgrade };
}
`);

{
  const path = "conduit-web/test/pty-transport.test.js";
  let content = await read(path);
  content = replaceOnce(
    content,
    `function openTerminal(origin, id) {
  const socket = new WebSocket(\`${origin.replace("http", "ws")}/v0/ptys/\${id}/attach\`);
  const messages = [];
  socket.on("message", (data, isBinary) => messages.push({ data: Buffer.from(data), isBinary }));`,
    `function openTerminal(origin, id) {
  const socket = new WebSocket(\`${origin.replace("http", "ws")}/v0/ptys/\${id}/attach\`);
  const messages = [];
  socket.on("message", (data, isBinary) => {
    const frame = { data: Buffer.from(data), isBinary };
    messages.push(frame);
    if (!isBinary) {
      try {
        if (JSON.parse(frame.data.toString()).type === "replay_end") socket.send(JSON.stringify({ type: "restore_ready" }));
      } catch {}
    }
  });`,
    "test client restore acknowledgement",
  );
  await write(path, content);
}
