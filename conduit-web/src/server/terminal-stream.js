import { WebSocketServer } from "ws";
import { PtyOutputBatcher } from "../pty-output-batcher.js";
import { PTY_MAX_INPUT_BYTES } from "../pty-manager.js";

const TERMINAL_PENDING_LIMIT = 1024 * 1024;
const PTY_IN_USE_CLOSE_CODE = 4009;

function boundedDimension(value, fallback) {
  const next = Math.trunc(Number(value));
  return Number.isInteger(next) && next >= 1 && next <= 500 ? next : fallback;
}

export function createTerminalStream({ terminals }) {
  // Keep terminal payload limits isolated from chat/dictation WebSockets. ws
  // rejects oversized terminal frames before buffering them for application code.
  const wss = new WebSocketServer({ noServer: true, maxPayload: PTY_MAX_INPUT_BYTES });
  let shuttingDown = false;

  // One browser owns one terminal id at a time. There is deliberately no
  // global lease: unrelated tmux sessions may stream concurrently.
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

  const sendClientError = (ws, error) => {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({
      type: "client_error",
      code: error?.code || "pty_attach_failed",
      message: error?.message || "Terminal attachment failed",
    }));
  };

  const detachClient = (id, ws) => {
    if (terminalClients.get(id) === ws) terminalClients.delete(id);
  };

  terminals.on("exit", (record) => {
    const ws = terminalClients.get(record.id);
    if (!ws || ws.readyState !== ws.OPEN) return;
    sendStatus(ws, record);
    ws.send(JSON.stringify({ type: "control", writable: false }));
    ws.close(1000, "Terminal exited");
  });

  terminals.on("removed", ({ id }) => {
    const ws = terminalClients.get(id);
    if (ws && ws.readyState === ws.OPEN) ws.close(1001, "Terminal was removed");
    terminalClients.delete(id);
  });

  const handleUpgrade = (id, request, socket, head) => {
    if (shuttingDown) return socket.destroy();
    return wss.handleUpgrade(request, socket, head, (ws) => {
    // Reserve synchronously before terminals.attach() does asynchronous tmux
    // work. This is transport-level defense in depth for the manager lease.
    if (terminalClients.has(id)) {
      const error = Object.assign(new Error("Terminal is attached in another Conduit client"), { code: "pty_in_use" });
      sendClientError(ws, error);
      ws.close(PTY_IN_USE_CLOSE_CODE, "pty_in_use");
      return;
    }
    terminalClients.set(id, ws);

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
        sendClientError(ws, error);
      }
    });

    // maxPayload violations surface as WebSocket errors before close. Dispose
    // the disposable tmux attachment and release the lease without affecting
    // the durable tmux session.
    ws.on("error", () => {
      detachClient(id, ws);
      disposeAttachment();
    });

    ws.on("close", () => {
      detachClient(id, ws);
      disposeAttachment();
    });

    void (async () => {
      try {
        attachment = await terminals.attach(id, { cols: initialCols, rows: initialRows });
        if (disposed || ws.readyState !== ws.OPEN || terminalClients.get(id) !== ws) {
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
              ws.close(1011, "Terminal attachment ended");
            }
          }).catch(() => ws.close(1011, "Terminal attachment failed"));
        });

        sendStatus(ws, terminals.get(id));
        ws.send(JSON.stringify({ type: "control", writable: true }));
      } catch (error) {
        detachClient(id, ws);
        if (ws.readyState === ws.OPEN) {
          sendClientError(ws, error);
          if (error?.code === "pty_in_use") ws.close(PTY_IN_USE_CLOSE_CODE, "pty_in_use");
          else ws.close(1011, "Terminal attachment failed");
        }
      }
    })();
    });
  };

  const shutdown = async ({ timeoutMs = 1_000 } = {}) => {
    shuttingDown = true;
    const clients = [...wss.clients];
    const closed = clients.map((ws) => new Promise((resolve) => {
      if (ws.readyState === ws.CLOSED) return resolve();
      ws.once("close", resolve);
    }));
    for (const ws of clients) {
      try { ws.close(1012, "Conduit is restarting"); }
      catch { ws.terminate?.(); }
    }
    await Promise.race([
      Promise.all(closed),
      new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(timeoutMs) || 0))),
    ]);
    for (const ws of wss.clients) ws.terminate?.();
    return { closed: wss.clients.size === 0 };
  };

  return { handleUpgrade, shutdown };
}
