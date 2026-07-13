import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import { loadConfig } from "./config.js";
import { discoverSessions, findSession } from "./session-store.js";
import { PiManager } from "./pi-manager.js";

const config = loadConfig();
const manager = new PiManager({ command: config.piCommand });
const app = express();
app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), "../public")));

app.get("/healthz", (_request, response) => response.json({ ok: true }));
app.get("/v0/capabilities", (_request, response) => response.json({
  runtime: "pi-rpc",
  create: true,
  resume: true,
  stream: "websocket",
  processOwner: "conduit-runtime",
}));

app.get("/v0/sessions", async (_request, response, next) => {
  try {
    const persisted = await discoverSessions(config.sessionsDir);
    const liveById = new Map(manager.list().map((session) => [session.id, session]));
    response.json({ sessions: persisted.map((session) => ({ ...session, file: undefined, status: liveById.get(session.id)?.status || session.status })), live: manager.list() });
  } catch (error) { next(error); }
});

app.post("/v0/sessions", async (request, response, next) => {
  try {
    const requestedId = request.body?.resumeSessionId;
    const session = requestedId ? await findSession(config.sessionsDir, requestedId) : null;
    if (requestedId && !session) return response.status(404).json({ error: "session_not_found" });
    const live = manager.create({ sessionFile: session?.file });
    response.status(201).json({ id: live.id, status: live.status, streamUrl: `/v0/sessions/${live.id}/stream` });
  } catch (error) { next(error); }
});

app.delete("/v0/sessions/:id/process", (request, response) => {
  response.status(manager.stop(request.params.id) ? 202 : 404).json({ stopped: true });
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: "runtime_error", message: error.message });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (request, socket, head) => {
  const match = new URL(request.url, "http://localhost").pathname.match(/^\/v0\/sessions\/([a-f0-9]{24})\/stream$/);
  if (!match || !manager.processes.has(match[1])) return socket.destroy();
  wss.handleUpgrade(request, socket, head, (ws) => {
    manager.attach(match[1], ws);
    ws.on("message", (data) => {
      try { manager.send(match[1], JSON.parse(String(data))); }
      catch (error) { ws.send(JSON.stringify({ type: "client_error", message: error.message })); }
    });
    ws.send(JSON.stringify({ type: "runtime_connected", sessionId: match[1] }));
  });
});

server.listen(config.port, config.host, () => {
  console.log(`Conduit custom runtime listening on http://${config.host}:${config.port}`);
});

