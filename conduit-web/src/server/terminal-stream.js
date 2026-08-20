import { PtyOutputBatcher } from "../pty-output-batcher.js";

const TERMINAL_PENDING_LIMIT = 1024 * 1024;

function boundedDimension(value, fallback) {
  const next = Math.trunc(Number(value));
  return Number.isInteger(next) && next >= 1 && next <= 500 ? next : fallback;
}

export function createTerminalStream({ terminals, wss }) {
  const terminalClients = new Map();

  const sendOutput = (ws, bytes) => {
    if (ws.readyState !== ws.OPEN) return;
    if (ws.bufferedAmount > TERMINAL_PENDING_LIMIT) {
      ws.close(1013, "Terminal client is too slow");
      return;
    }
    ws.send(bytes, { binary: true });
  };

  const sendStatus = (ws, record) => {
    if (ws.readyState !== ws.OPEN || !record) return;
    ws.send(JSON.stringify({
      type: "status",
      status: record.status,
      exitCode: record.exitCode ?? null,
      signal: record.signal ?? null,
    }));
  };

  const detachClient = (id, ws) => {
    const clients = terminalClients.get(id);
    if (!clients) return;
    clients.delete(ws);
    if (!clients.size) terminalClients.delete(id);
  };

  terminals.on("exit", (record) => {
    for (const ws of terminalClients.get(record.id) || []) {
      if (ws.readyState !== ws.OPEN) continue;
      sendStatus(ws, record);
      ws.send(JSON.stringify({ type: "control", writable: false }));
      ws.close(1000, "Terminal exited");
    }
  });

  terminals.on("removed", ({ id }) => {
    for (const ws of terminalClients.get(id) || []) {
      if (ws.readyState === ws.OPEN) ws.close(1001, "Terminal was removed");
    }
    terminalClients.delete(id);
  });

  const handleUpgrade = (id, request, socket, head) => wss.handleUpgrade(request, socket, head, (ws) => {
    const clients = terminalClients.get(id) || new Set();
    clients.add(ws);
    terminalClients.set(id, clients);

    let attachment;
    let disposed = false;
    let removeData = () => {};
    let removeExit = () => {};
    const output = new PtyOutputBatcher((_id, bytes) => sendOutput(ws, bytes));
    const requestUrl = new URL(request.url || "/", "http://localhost");
    const initialCols = boundedDimension(requestUrl.searchParams.get("cols"), 80);
    const initialRows = boundedDimension(requestUrl.searchParams.get("rows"), 24);

    const disposeAttachment = () => {
      if (disposed) return;
      disposed = true;
      output.flushAll();
      removeData();
      removeExit();
      try { attachment?.kill(); } catch {}
      attachment = undefined;
    };

    ws.on("message", (data, isBinary) => {
      if (!attachment) return;
      try {
        if (isBinary) {
          // Preserve producer/output ordering around input that may immediately
          // change the screen. The browser remains a thin byte-stream client.
          output.flushAll();
          attachment.write(data);
          return;
        }
        const command = JSON.parse(String(data));
        if (command.type !== "resize") throw Object.assign(new Error("Unknown terminal control frame"), { code: "pty_control_invalid" });
        output.flushAll();
        attachment.resize(command.cols, command.rows);
      } catch (error) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "client_error", code: error.code, message: error.message }));
      }
    });

    ws.on("close", () => {
      detachClient(id, ws);
      disposeAttachment();
    });

    void (async () => {
      try {
        attachment = await terminals.attach(id, { cols: initialCols, rows: initialRows });
        if (disposed || ws.readyState !== ws.OPEN) {
          attachment.kill();
          attachment = undefined;
          return;
        }
        removeData = attachment.onData((value) => output.append(id, Buffer.from(value)));
        removeExit = attachment.onExit(() => {
          output.flushAll();
          if (disposed || ws.readyState !== ws.OPEN) return;
          void terminals.reconcile().then(() => {
            if (disposed || ws.readyState !== ws.OPEN) return;
            const record = terminals.get(id);
            if (record?.status === "exited") {
              sendStatus(ws, record);
              ws.send(JSON.stringify({ type: "control", writable: false }));
              ws.close(1000, "Terminal exited");
            } else {
              // Only the disposable tmux client died; keep the tmux session and
              // let the browser reconnect to a fresh attachment.
              ws.close(1012, "Terminal attachment ended");
            }
          }).catch(() => ws.close(1011, "Terminal attachment failed"));
        });

        // Every human browser attachment is writable. tmux owns the durable
        // session; Conduit no longer elects a browser protocol/controller owner.
        sendStatus(ws, terminals.get(id));
        ws.send(JSON.stringify({ type: "control", writable: true }));
      } catch (error) {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "client_error", code: error.code, message: error.message }));
          ws.close(1011, "Terminal attachment failed");
        }
      }
    })();
  });

  return { handleUpgrade };
}
