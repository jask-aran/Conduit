import { PtyOutputBatcher } from "../pty-output-batcher.js";

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
    if (terminalControllers.get(id) === ws) terminalControllers.delete(id);
    if (!clients.size) {
      terminalClients.delete(id);
      terminalControllers.delete(id);
      return;
    }
    promoteTerminalController(id);
  };

  const terminalOutput = new PtyOutputBatcher((id, bytes) => {
    for (const ws of terminalClients.get(id) || []) {
      if (ws.readyState !== ws.OPEN) continue;
      if (ws.bufferedAmount > 1024 * 1024) {
        ws.close(1013, "Terminal client is too slow");
        continue;
      }
      ws.send(bytes, { binary: true });
    }
  });

  terminals.on("output", ({ id, bytes }) => terminalOutput.append(id, bytes));
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

    const replay = terminals.replay(id);
    ws.send(JSON.stringify({ type: "replay_start", complete: replay.complete }));
    if (replay.bytes.length) ws.send(replay.bytes, { binary: true });
    ws.send(JSON.stringify({ type: "replay_end" }));
    ws.send(JSON.stringify({ type: "status", status: record.status, exitCode: record.exitCode, signal: record.signal }));
    sendTerminalControl(id);

    ws.on("message", (data, isBinary) => {
      try {
        if (terminalControllers.get(id) !== ws) {
          throw Object.assign(new Error("Another attached browser currently controls this terminal"), { code: "pty_read_only" });
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
  });

  return { handleUpgrade };
}
