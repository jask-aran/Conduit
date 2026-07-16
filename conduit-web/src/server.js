import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import compression from "compression";
import { WebSocketServer } from "ws";
import { loadConfig } from "./config.js";
import { createMarkdownRenderer, stableMarkdownBoundary } from "./markdown-renderer.js";
import { PiModelCatalog } from "./pi-model-catalog.js";
import { ProjectStore } from "./project-store.js";
import { duplicateSession, messagesFromEntries, moveSession, moveSessions, pageSessionEntries, projectSessionView, removeSession, renameSession, settingsFromEntries, toolsFromEntries, transcriptFromEntries } from "./session-store.js";
import { PiManager } from "./pi-manager.js";
import { SessionRegistry } from "./session-registry.js";
import { openWorkingDirectory } from "./workspace-opener.js";

const config = loadConfig();
const projects = new ProjectStore(config);
await projects.initialize();
const registry = new SessionRegistry(config.sessionRegistryFile);
await registry.initialize(await projects.list());
const renderMarkdown = await createMarkdownRenderer();
const manager = new PiManager({
  command: config.piCommand,
  agentDir: config.piAgentDir,
  template: config.piTemplate,
  renderMarkdown,
  stableBoundary: stableMarkdownBoundary,
});
const modelCatalog = new PiModelCatalog({ agentDir: config.piAgentDir, modelPatterns: config.piTemplate.models });
const app = express();
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");

app.use(compression());
app.use(express.json({ limit: "128kb" }));

async function findRegisteredSession(id) {
  return registry.find(await projects.list(), id);
}

const pendingCheckpoints = new Set();
const registeredFiles = new Set(registry.list().map((session) => session.file));
manager.on("event", ({ record }) => {
  if (!record.sessionFile || pendingCheckpoints.has(record.id)) return;
  const initialSave = !registeredFiles.has(record.sessionFile);
  if (record.active && !initialSave) return;
  registeredFiles.add(record.sessionFile);
  pendingCheckpoints.add(record.id);
  setTimeout(() => {
    projects.get(record.projectId)
      .then((project) => project && registry.syncFile(record.sessionFile, project))
      .then((session) => session && manager.publish(record, { type: "session_checkpoint", session }))
      .catch((error) => console.error("Could not checkpoint the session registry", error))
      .finally(() => pendingCheckpoints.delete(record.id));
  }, 50).unref();
});
app.get("/healthz", (_request, response) => response.json({ ok: true, filesRoot: config.filesRoot }));
app.get("/v0/capabilities", (_request, response) => response.json({
  runtime: "pi-rpc", create: true, resume: true, projects: true,
  sessionManagement: true, workspaceOpen: true,
  stream: "websocket", processOwner: "conduit-server", sessionAuthority: "pi-jsonl",
}));

async function stopSessionProcesses(session) {
  const matching = manager.list().filter((item) => item.sessionFile === session.file);
  await Promise.all(matching.map((item) => manager.stopAndWait(item.id)));
}

app.get("/v0/projects", async (_request, response, next) => {
  try {
    const items = await projects.list();
    const live = manager.list();
    response.json({ projects: await Promise.all(items.map(async (project) => ({
      ...project,
      sessions: registry.listProject(project.id).map((session) => {
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

app.patch("/v0/projects/:id", async (request, response, next) => {
  try {
    const name = String(request.body?.name || "").trim();
    if (!name) return response.status(400).json({ error: "project_name_required" });
    const project = await projects.rename(request.params.id, name);
    if (!project) return response.status(404).json({ error: "project_not_found" });
    response.json(project);
  } catch (error) { next(error); }
});

app.post("/v0/projects/:id/open", async (request, response, next) => {
  try {
    const project = await projects.get(request.params.id);
    if (!project) return response.status(404).json({ error: "project_not_found" });
    await openWorkingDirectory(project.path);
    response.status(202).json({ opened: true, path: project.path });
  } catch (error) { next(error); }
});

app.post("/v0/projects/:id/move-sessions", async (request, response, next) => {
  try {
    const source = await projects.get(request.params.id);
    const target = await projects.get(request.body?.projectId || "");
    if (!source || !target) return response.status(404).json({ error: "project_not_found" });
    if (source.id === target.id) return response.status(409).json({ error: "project_target_unchanged" });
    const projectList = await projects.list();
    const sessions = (await Promise.all(registry.listProject(source.id).map((session) => registry.find(projectList, session.id)))).filter(Boolean);
    await Promise.all(sessions.map(stopSessionProcesses));
    const moved = await moveSessions(sessions, target);
    for (let index = 0; index < sessions.length; index += 1) {
      await registry.remove(sessions[index].id);
      await registry.upsert(moved[index]);
    }
    response.json({ moved: moved.map((session, index) => ({
      sourceId: sessions[index].id,
      session: projectSessionView(session),
    })) });
  } catch (error) { next(error); }
});

app.delete("/v0/projects/:id", async (request, response, next) => {
  try {
    const project = await projects.get(request.params.id);
    if (!project) return response.status(404).json({ error: "project_not_found" });
    const matching = manager.list().filter((item) => item.projectId === project.id);
    await Promise.all(matching.map((item) => manager.stopAndWait(item.id)));
    await Promise.all(registry.listProject(project.id).map(removeSession));
    await registry.removeProject(project.id);
    await projects.remove(project.id);
    response.status(204).end();
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

app.get("/v0/settings", async (request, response, next) => {
  try {
    const project = await projects.get(request.query.projectId || "chat");
    if (!project) return response.status(404).json({ error: "project_not_found" });
    response.json(await modelCatalog.getSettings(project.path));
  } catch (error) {
    next(error);
  }
});

app.patch("/v0/settings", async (request, response, next) => {
  try {
    const project = await projects.get(request.body?.projectId || "chat");
    if (!project) return response.status(404).json({ error: "project_not_found" });
    response.json(await modelCatalog.updateSettings(project.path, request.body));
  } catch (error) {
    next(error);
  }
});

app.get("/v0/sessions/:id", async (request, response, next) => {
  try {
    const session = await findRegisteredSession(request.params.id);
    if (!session) return response.status(404).json({ error: "session_not_found" });
    const page = pageSessionEntries(session.entries, { before: request.query.before });
    const messages = messagesFromEntries(page.entries).filter((message) => ["user", "assistant"].includes(message.role));
    response.json({
      ...projectSessionView(session),
      ...settingsFromEntries(session.entries),
      messages: await Promise.all(messages.map(async (message) => message.role === "assistant"
        ? { ...message, html: await renderMarkdown(message.content) }
        : message)),
      tools: toolsFromEntries(page.entries).map((tool) => ({ ...tool, result: tool.result?.length > 4000 ? null : tool.result, resultDeferred: tool.result?.length > 4000 })),
      page: { before: page.hasMore ? String(page.start) : null },
    });
  } catch (error) { next(error); }
});

app.get("/v0/sessions/:id/transcript", async (request, response, next) => {
  try {
    const session = await findRegisteredSession(request.params.id);
    if (!session) return response.status(404).json({ error: "session_not_found" });
    response.type("text/markdown").send(transcriptFromEntries(session.entries));
  } catch (error) { next(error); }
});

app.get("/v0/sessions/:id/tools/:toolId", async (request, response, next) => {
  try {
    const session = await findRegisteredSession(request.params.id);
    if (!session) return response.status(404).json({ error: "session_not_found" });
    const tool = toolsFromEntries(session.entries).find((item) => item.id === request.params.toolId);
    if (!tool) return response.status(404).json({ error: "tool_not_found" });
    response.json({ id: tool.id, result: tool.result ?? null });
  } catch (error) { next(error); }
});

app.patch("/v0/sessions/:id", async (request, response, next) => {
  try {
    const name = String(request.body?.name || "").trim();
    if (!name) return response.status(400).json({ error: "session_name_required" });
    const projectList = await projects.list();
    const session = await registry.find(projectList, request.params.id);
    if (!session) return response.status(404).json({ error: "session_not_found" });
    const project = projectList.find((item) => item.id === session.projectId);
    await stopSessionProcesses(session);
    const renamed = await renameSession(session, project, name);
    await registry.upsert(renamed);
    response.json(projectSessionView(renamed));
  } catch (error) { next(error); }
});

app.post("/v0/sessions/:id/duplicate", async (request, response, next) => {
  try {
    const projectList = await projects.list();
    const session = await registry.find(projectList, request.params.id);
    if (!session) return response.status(404).json({ error: "session_not_found" });
    const project = projectList.find((item) => item.id === session.projectId);
    const duplicate = await duplicateSession(session, project, `${session.title} copy`);
    await registry.upsert(duplicate);
    response.status(201).json(projectSessionView(duplicate));
  } catch (error) { next(error); }
});

app.post("/v0/sessions/:id/move", async (request, response, next) => {
  try {
    const projectList = await projects.list();
    const session = await registry.find(projectList, request.params.id);
    const target = projectList.find((item) => item.id === request.body?.projectId || item.slug === request.body?.projectId);
    if (!session) return response.status(404).json({ error: "session_not_found" });
    if (!target) return response.status(404).json({ error: "project_not_found" });
    if (session.projectId === target.id) return response.status(409).json({ error: "session_project_unchanged" });
    await stopSessionProcesses(session);
    const moved = await moveSession(session, target);
    await registry.remove(session.id);
    await registry.upsert(moved);
    response.json(projectSessionView(moved));
  } catch (error) { next(error); }
});

app.delete("/v0/sessions/:id", async (request, response, next) => {
  try {
    const session = await findRegisteredSession(request.params.id);
    if (!session) return response.status(404).json({ error: "session_not_found" });
    await stopSessionProcesses(session);
    await removeSession(session);
    await registry.remove(session.id);
    response.status(204).end();
  } catch (error) { next(error); }
});

app.get("/v0/live-sessions", (_request, response) => response.json({ sessions: manager.list() }));
app.post("/v0/live-sessions", async (request, response, next) => {
  try {
    const project = await projects.get(request.body?.projectId || "chat");
    if (!project) return response.status(404).json({ error: "project_not_found" });
    const requestedId = request.body?.resumeSessionId;
    const session = requestedId ? await findRegisteredSession(requestedId) : null;
    if (requestedId && !session) return response.status(404).json({ error: "session_not_found" });
    if (session && session.projectId !== project.id) return response.status(409).json({ error: "session_project_mismatch" });
    const live = manager.create({
      project,
      sessionFile: session?.file,
      model: request.body?.model || "",
      thinkingLevel: request.body?.thinkingLevel || "",
      models: modelCatalog.getLaunchModels(project.path),
    });
    response.status(201).json({ ...manager.view(live), streamUrl: `/v0/live-sessions/${live.id}/stream` });
  } catch (error) { next(error); }
});

app.get("/v0/live-sessions/:id/snapshot", async (request, response, next) => {
  try {
    const live = manager.get(request.params.id);
    if (!live) return response.status(404).json({ error: "live_session_not_found" });
    const persisted = live.sessionFile ? await findRegisteredSession(live.sessionFile) : null;
    response.json({ live: manager.view(live), events: live.events, messages: persisted ? messagesFromEntries(persisted.entries) : [] });
  } catch (error) { next(error); }
});

app.delete("/v0/live-sessions/:id/process", (request, response) => {
  const stopped = manager.stop(request.params.id);
  response.status(stopped ? 202 : 404).json({ stopped });
});

app.use(express.static(dist, {
  setHeaders(response, file) {
    if (file.includes(`${path.sep}assets${path.sep}`)) response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    else response.setHeader("Cache-Control", "no-cache");
  },
}));
app.get("*", (request, response, next) => {
  if (request.path.startsWith("/v0/") || request.path === "/healthz") return next();
  response.setHeader("Cache-Control", "no-cache");
  response.sendFile(path.join(dist, "index.html"));
});
app.use((error, _request, response, _next) => {
  console.error(error);
  const status = error.code === "reserved_project"
    ? 409
    : ["enabled_models_required", "invalid_enabled_model", "invalid_default_model"].includes(error.code) || error.message?.includes("Project names")
      ? 400
      : 500;
  response.status(status).json({ error: error.code || "runtime_error", message: error.message });
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
