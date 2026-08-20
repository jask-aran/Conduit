import { PtyOutputBatcher } from "../pty-output-batcher.js";

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
    // Preserve PTY mutation order: any output accumulated earlier in this turn
    // must reach live clients before the resize that followed it.
    terminalOutput.flush(id);
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
      // Replay uses the same wire representation as live traffic: tiny text
      // control frames for geometry and raw binary terminal bytes for output.
      // No Base64/JSON envelope sits on the browser's restore path.
      for (const event of replay.events || []) sendRestoreEvent(ws, event);
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
