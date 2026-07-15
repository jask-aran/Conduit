import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import { loadConfig } from "./config.js";
import { PiModelCatalog } from "./pi-model-catalog.js";
import { ProjectStore } from "./project-store.js";
import { discoverProjectSessions, findSession, messagesFromEntries, projectSessionView } from "./session-store.js";
import { PiManager } from "./pi-manager.js";

const config = loadConfig();
const projects = new ProjectStore(config);
await projects.initialize();
const manager = new PiManager({ command: config.piCommand, agentDir: config.piAgentDir, template: config.piTemplate });
const modelCatalog = new PiModelCatalog({ agentDir: config.piAgentDir, modelPatterns: config.piTemplate.models });
const app = express();
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");

app.use(express.json({ limit: "128kb" }));
app.get("/healthz", (_request, response) => response.json({ ok: true, filesRoot: config.filesRoot }));
app.get("/v0/capabilities", (_request, response) => response.json({
  runtime: "pi-rpc", create: true, resume: true, projects: true,
  stream: "websocket", processOwner: "conduit-server", sessionAuthority: "pi-jsonl",
}));

app.get("/v0/projects", async (_request, response, next) => {
  try {
    const items = await projects.list();
    const live = manager.list();
    response.json({ projects: await Promise.all(items.map(async (project) => ({
      ...project,
      sessions: (await discoverProjectSessions(project)).map((session) => {
        const process = live.find((item) => item.sessionFile === session.file);
        return { ...projectSessionView(session), status: process?.status || session.status, liveId: process?.id || null };
      }),
    }))), live });
  } catch (error) { next(error); }
});

app.post("/v0/projects", async (request, response, next) => {
  try {
    const name = String(request.body?.name || "").trim();
    if (!name) return response.status(400).json({ error: "project_name_required" });
    response.status(201).json(await projects.create({ name }));
  } catch (error) { next(error); }
});

app.get("/v0/models", async (request, response, next) => {
  try {
    const project = await projects.get(request.query.projectId || "chat");
    if (!project) return response.status(404).json({ error: "project_not_found" });
    response.json(await modelCatalog.list(project.path));
  } catch (error) {
    next(error);
  }
});

app.get("/v0/sessions/:id", async (request, response, next) => {
  try {
    const session = await findSession(await projects.list(), request.params.id);
    if (!session) return response.status(404).json({ error: "session_not_found" });
    response.json({ ...projectSessionView(session), messages: messagesFromEntries(session.entries) });
  } catch (error) { next(error); }
});

app.get("/v0/live-sessions", (_request, response) => response.json({ sessions: manager.list() }));
app.post("/v0/live-sessions", async (request, response, next) => {
  try {
    const project = await projects.get(request.body?.projectId || "chat");
    if (!project) return response.status(404).json({ error: "project_not_found" });
    const requestedId = request.body?.resumeSessionId;
    const session = requestedId ? await findSession(await projects.list(), requestedId) : null;
    if (requestedId && !session) return response.status(404).json({ error: "session_not_found" });
    if (session && session.projectId !== project.id) return response.status(409).json({ error: "session_project_mismatch" });
    const live = manager.create({
      project,
      sessionFile: session?.file,
      model: request.body?.model || "",
      thinkingLevel: request.body?.thinkingLevel || "",
    });
    response.status(201).json({ ...manager.view(live), streamUrl: `/v0/live-sessions/${live.id}/stream` });
  } catch (error) { next(error); }
});

app.get("/v0/live-sessions/:id/snapshot", async (request, response, next) => {
  try {
    const live = manager.get(request.params.id);
    if (!live) return response.status(404).json({ error: "live_session_not_found" });
    const persisted = live.sessionFile ? await findSession(await projects.list(), live.sessionFile) : null;
    response.json({ live: manager.view(live), events: live.events, messages: persisted ? messagesFromEntries(persisted.entries) : [] });
  } catch (error) { next(error); }
});

app.delete("/v0/live-sessions/:id/process", (request, response) => {
  const stopped = manager.stop(request.params.id);
  response.status(stopped ? 202 : 404).json({ stopped });
});

app.use(express.static(dist));
app.get("*", (request, response, next) => {
  if (request.path.startsWith("/v0/") || request.path === "/healthz") return next();
  response.sendFile(path.join(dist, "index.html"));
});
app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(error.message?.includes("Project names") ? 400 : 500).json({ error: "runtime_error", message: error.message });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (request, socket, head) => {
  const match = new URL(request.url, "http://localhost").pathname.match(/^\/v0\/live-sessions\/([a-f0-9]{24})\/stream$/);
  if (!match || !manager.get(match[1])) return socket.destroy();
  wss.handleUpgrade(request, socket, head, (ws) => {
    const record = manager.get(match[1]);
    manager.attach(match[1], ws);
    const turnStart = record.events.findLastIndex((event) => event.type === "agent_start");
    const pendingEvents = record.active && turnStart >= 0 ? record.events.slice(turnStart) : [];
    ws.send(JSON.stringify({ type: "runtime_snapshot", session: manager.view(record), events: pendingEvents }));
    ws.on("message", (data) => {
      try { manager.send(match[1], JSON.parse(String(data))); }
      catch (error) { ws.send(JSON.stringify({ type: "client_error", message: error.message })); }
    });
  });
});

server.listen(config.port, config.host, () => console.log(`Conduit listening on http://${config.host}:${config.port}`));
