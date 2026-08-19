import { PtyOutputBatcher } from "../pty-output-batcher.js";

const TERMINAL_PENDING_LIMIT = 1024 * 1024;

export function createTerminalStream({ terminals, wss }) {
  const terminalClients = new Map();
  const terminalControllers = new Map();

  const sendTerminalControl = (id) => {
    const controller = terminalControllers.get(id) || null;
    for (const ws of terminalClients.get(id) || []) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "control", writable: ws === controller }));
    }
  };

  const promoteTerminalController = (id) => {
    if (terminalControllers.has(id)) return;
    const record = terminals.get(id);
    if (record?.status !== "running") return sendTerminalControl(id);
    const next = [...(terminalClients.get(id) || [])].find((ws) => ws.readyState === ws.OPEN);
    if (next) terminalControllers.set(id, next);
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

  const terminalOutput = new PtyOutputBatcher((id, bytes) => {
    for (const ws of terminalClients.get(id) || []) {
      if (ws.readyState !== ws.OPEN || ws.conduitTerminalRestoring) continue;
      sendOutput(ws, bytes);
    }
  });

  terminals.on("output", ({ id, bytes, sequence }) => {
    // Restoring clients need unbatched, sequenced deltas so bytes already
    // represented by their canonical state cut can be discarded exactly.
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
      ws.send(JSON.stringify({ type: "control", writable: false }));
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
    const clients = terminalClients.get(id) || new Set();
    clients.add(ws);
    terminalClients.set(id, clients);
    const record = terminals.get(id);
    if (record.status === "running" && !terminalControllers.has(id)) terminalControllers.set(id, ws);

    ws.conduitTerminalRestoring = true;
    ws.conduitTerminalPending = [];
    ws.conduitTerminalPendingBytes = 0;

    ws.on("message", (data, isBinary) => {
      try {
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
        // The bounded byte journal remains a safe fallback. It is deliberately
        // discarded once incomplete rather than replaying a corrupt ANSI tail.
        replay = terminals.replay(id);
      }
      if (ws.readyState !== ws.OPEN) return;

      // Clear every output batch accumulated while the state cut was being
      // serialized. Established clients receive it; this restoring client skips
      // the batch because it captured each mutation with a sequence above.
      terminalOutput.flush(id);
      const boundary = replay.sequence || 0;
      const pending = ws.conduitTerminalPending.filter((event) => event.sequence > boundary);
      ws.conduitTerminalPending = [];
      ws.conduitTerminalPendingBytes = 0;

      ws.send(JSON.stringify({ type: "replay_start", complete: replay.complete, source: replay.source || "journal" }));
      if (replay.bytes.length) ws.send(replay.bytes, { binary: true });
      for (const event of pending) {
        if (event.type === "resize") ws.send(JSON.stringify({ type: "replay_resize", cols: event.cols, rows: event.rows }));
        else sendOutput(ws, event.bytes);
      }
      ws.send(JSON.stringify({ type: "replay_end" }));
      ws.send(JSON.stringify({ type: "status", status: record.status, exitCode: record.exitCode, signal: record.signal }));
      ws.conduitTerminalRestoring = false;
      sendTerminalControl(id);
    })().catch(() => {
      if (ws.readyState === ws.OPEN) ws.close(1011, "Terminal state restoration failed");
    });
  });

  return { handleUpgrade };
}
