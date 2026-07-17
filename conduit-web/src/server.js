import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import compression from "compression";
import { WebSocketServer } from "ws";
import { loadConfig } from "./config.js";
import { PiModelCatalog } from "./pi-model-catalog.js";
import { ProjectStore } from "./project-store.js";
import { messagesFromEntries, moveSession, pageSessionEntries, removeSession, renameSession, settingsFromEntries, toolsFromEntries, transcriptFromEntries } from "./session-store.js";
import { PiManager } from "./pi-manager.js";
import { ChatStore, chatView, isChatId } from "./chat-store.js";
import { AttachmentStore } from "./attachment-store.js";
import { announcedAttachmentIds, serializeAttachmentEnvelope } from "./attachment-envelope.js";
import { CONTINUE_PROMPT } from "./continuation.js";
import { RuntimeHub } from "./runtime-hub.js";
import { defaultsFromEnv, RuntimeSettingsStore } from "./runtime-settings.js";

const config = loadConfig();
const projects = new ProjectStore(config);
await projects.initialize();
const registry = new ChatStore(config.sessionRegistryFile);
await registry.initialize(await projects.list());
const attachments = new AttachmentStore(registry);
const runtimeSettings = new RuntimeSettingsStore(config.runtimeSettingsFile, defaultsFromEnv(process.env));
await runtimeSettings.load();
const manager = new PiManager({
  command: config.piCommand,
  agentDir: config.piAgentDir,
  template: config.piTemplate,
  maxLiveProcesses: runtimeSettings.get().maxLiveProcesses,
  maxGeneratingProcesses: runtimeSettings.get().maxGeneratingProcesses,
  idleProcessTtlMs: runtimeSettings.get().idleProcessTtlMs,
});
const runtimeHub = new RuntimeHub({ listViews: () => manager.list() });
manager.on("process_changed", ({ record, reason }) => {
  runtimeHub.publishProcess(manager.view(record), reason || "update");
});
manager.on("process_removed", ({ id, chatId }) => {
  runtimeHub.publishProcessRemoved(id, chatId);
});
const modelCatalog = new PiModelCatalog({ agentDir: config.piAgentDir, modelPatterns: config.piTemplate.models });
const app = express();
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");

app.use(compression());

async function findRegisteredSession(id) {
  return registry.find(await projects.list(), id);
}

async function findChatContext(chatId) {
  if (!isChatId(chatId)) return null;
  const chat = registry.metadata(chatId);
  if (!chat) return null;
  const project = await projects.get(chat.projectId);
  return project ? { chat, project } : null;
}

app.put("/v0/chats/:chatId/attachments/:attachmentId", async (request, response, next) => {
  try {
    const context = await findChatContext(request.params.chatId);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    const attachment = await attachments.write(
      context.project,
      context.chat.id,
      request.params.attachmentId,
      request.query.name,
      request,
    );
    response.status(201).json(attachment);
  } catch (error) {
    if (error.code === "EEXIST") return response.status(409).json({ error: "attachment_exists" });
    next(error);
  }
});

app.use(express.json({ limit: "128kb" }));

const pendingCheckpoints = new Set();
manager.on("event", ({ record, event }) => {
  const chat = record.chatId ? registry.metadata(record.chatId) : null;
  if (!["agent_end", "generation_stopped"].includes(event.type)
    || !chat || chat.status !== "active" || !record.sessionFile || pendingCheckpoints.has(record.id) || record.active) return;
  pendingCheckpoints.add(record.id);
  setTimeout(() => {
    projects.get(record.projectId)
      .then((project) => project && registry.syncFile(record.chatId, record.sessionFile, project, { waitForFileMs: 2000 }))
      .then((session) => session && manager.publish(record, { type: "session_checkpoint", chat: chatView(registry.metadata(record.chatId)) }))
      .catch((error) => console.error("Could not checkpoint the session registry", error))
      .finally(() => pendingCheckpoints.delete(record.id));
  }, 50).unref();
});
app.get("/healthz", (_request, response) => response.json({ ok: true, filesRoot: config.filesRoot }));
app.get("/v0/capabilities", (_request, response) => response.json({
  runtime: "pi-rpc", create: true, resume: true, projects: true,
  sessionManagement: true, chatIdentity: "conduit", attachments: "raw-http",
  partialContinue: config.enablePartialContinue,
  stream: "websocket", processOwner: "conduit-server", sessionAuthority: "pi-jsonl",
  globalRuntime: "sse",
}));

app.get("/v0/runtime", (_request, response) => {
  response.json(runtimeHub.snapshot());
});

app.get("/v0/runtime/stream", (request, response) => {
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders?.();
  const client = { kind: "sse", response };
  const detach = runtimeHub.attach(client);
  const heartbeat = setInterval(() => {
    try { response.write(": ping\n\n"); }
    catch { clearInterval(heartbeat); detach(); }
  }, 25000);
  heartbeat.unref?.();
  request.on("close", () => {
    clearInterval(heartbeat);
    detach();
  });
});

async function stopSessionProcesses(session) {
  const chatId = session.chatId || session.id;
  const sessionFile = session.piSessionFile || session.file;
  const matching = manager.list().filter((item) => item.chatId === chatId || (sessionFile && item.sessionFile === sessionFile));
  await Promise.all(matching.map((item) => manager.stopAndWait(item.id)));
}

app.get("/v0/projects", async (_request, response, next) => {
  try {
    const items = await projects.list();
    const live = manager.list();
    response.json({ projects: await Promise.all(items.map(async (project) => ({
      ...project,
      sessions: registry.listProject(project.id).map((chat) => {
        const process = live.find((item) => item.chatId === chat.id);
        return {
          ...chatView(chat),
          liveStatus: process?.status || null,
          liveId: process?.id || null,
          liveActivity: process?.activity || null,
          liveActive: process?.active || false,
        };
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

app.post("/v0/projects/:id/move-sessions", async (request, response, next) => {
  try {
    const source = await projects.get(request.params.id);
    const target = await projects.get(request.body?.projectId || "");
    if (!source || !target) return response.status(404).json({ error: "project_not_found" });
    if (source.id === target.id) return response.status(409).json({ error: "project_target_unchanged" });
    const projectList = await projects.list();
    const chats = registry.listProject(source.id, { includeHidden: true });
    const moved = [];
    for (const chat of chats) {
      await stopSessionProcesses(chat);
      let session = chat.piSessionFile ? await registry.find(projectList, chat.id) : null;
      if (session) session = await moveSession(session, target);
      await registry.move(chat.id, source, target);
      if (session) await registry.commitSession(chat.id, session);
      moved.push({ sourceId: chat.id, session: chatView(registry.metadata(chat.id)) });
    }
    response.json({ moved });
  } catch (error) { next(error); }
});

app.delete("/v0/projects/:id", async (request, response, next) => {
  try {
    const project = await projects.get(request.params.id);
    if (!project) return response.status(404).json({ error: "project_not_found" });
    const matching = manager.list().filter((item) => item.projectId === project.id);
    await Promise.all(matching.map((item) => manager.stopAndWait(item.id)));
    const projectList = await projects.list();
    const sessions = (await Promise.all(registry.listProject(project.id, { includeHidden: true })
      .map((chat) => registry.find(projectList, chat.id)))).filter(Boolean);
    await Promise.all(sessions.map(removeSession));
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

app.post("/v0/chats", async (request, response, next) => {
  try {
    const project = await projects.get(request.body?.projectId || "chat");
    if (!project) return response.status(404).json({ error: "project_not_found" });
    response.status(201).json(chatView(await registry.create(project)));
  } catch (error) { next(error); }
});

app.get("/v0/chats/:chatId", async (request, response, next) => {
  try {
    const context = await findChatContext(request.params.chatId);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    response.json(chatView(context.chat));
  } catch (error) { next(error); }
});

app.delete("/v0/chats/:chatId", async (request, response, next) => {
  try {
    const context = await findChatContext(request.params.chatId);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    if (request.query.ifEmpty !== "true") return response.status(409).json({ error: "use_chat_delete_route" });
    await stopSessionProcesses(context.chat);
    const removed = await registry.removeEmptyDraft(context.chat.id, context.project);
    response.status(removed ? 204 : 409).end();
  } catch (error) { next(error); }
});

app.get("/v0/chats/:chatId/attachments", async (request, response, next) => {
  try {
    const context = await findChatContext(request.params.chatId);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    const session = await registry.find(await projects.list(), context.chat.id);
    const announced = session ? announcedAttachmentIds(session.entries) : new Set();
    response.json({ attachments: (await attachments.list(context.project, context.chat.id))
      .map((attachment) => ({ ...attachment, announced: announced.has(attachment.id) })) });
  } catch (error) { next(error); }
});

app.get("/v0/chats/:chatId/attachments/:attachmentId", async (request, response, next) => {
  try {
    const context = await findChatContext(request.params.chatId);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    const attachment = await attachments.open(context.project, context.chat.id, request.params.attachmentId);
    if (!attachment) return response.status(404).json({ error: "attachment_not_found" });
    const preview = request.query.preview === "1" && /^image\/(png|jpeg|gif|webp)$/.test(attachment.type);
    response.setHeader("Content-Type", preview ? attachment.type : "application/octet-stream");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "private, no-cache");
    const downloadName = encodeURIComponent(attachment.name).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    response.setHeader("Content-Disposition", `${preview ? "inline" : "attachment"}; filename*=UTF-8''${downloadName}`);
    response.setHeader("Content-Length", attachment.size);
    const stream = attachment.stream();
    stream.once("error", next);
    stream.pipe(response);
  } catch (error) { next(error); }
});

app.delete("/v0/chats/:chatId/attachments/:attachmentId", async (request, response, next) => {
  try {
    const context = await findChatContext(request.params.chatId);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    const removed = await attachments.delete(context.project, context.chat.id, request.params.attachmentId);
    response.status(removed ? 204 : 404).end();
  } catch (error) { next(error); }
});

app.get("/v0/sessions/:id", async (request, response, next) => {
  try {
    const context = await findChatContext(request.params.id);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    const session = await findRegisteredSession(request.params.id);
    if (!session) return response.json({
      ...chatView(context.chat), messages: [], tools: [], attachments: [], page: { before: null },
    });
    const page = pageSessionEntries(session.entries, { before: request.query.before });
    const messages = messagesFromEntries(page.entries).filter((message) => ["user", "assistant"].includes(message.role));
    response.json({
      ...chatView(context.chat),
      ...settingsFromEntries(session.entries),
      messages,
      tools: toolsFromEntries(page.entries).map((tool) => ({ ...tool, result: tool.result?.length > 4000 ? null : tool.result, resultDeferred: tool.result?.length > 4000 })),
      page: { before: page.hasMore ? String(page.start) : null },
    });
  } catch (error) { next(error); }
});

app.get("/v0/sessions/:id/transcript", async (request, response, next) => {
  try {
    const context = await findChatContext(request.params.id);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    const session = await findRegisteredSession(request.params.id);
    response.type("text/markdown").send(session ? transcriptFromEntries(session.entries) : "");
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
    const context = await findChatContext(request.params.id);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    const session = await registry.find(projectList, request.params.id);
    if (session) {
      await stopSessionProcesses(context.chat);
      const renamed = await renameSession(session, context.project, name);
      await registry.commitSession(context.chat.id, renamed);
    } else {
      await registry.update(context.chat.id, { title: name });
    }
    response.json(chatView(registry.metadata(context.chat.id)));
  } catch (error) { next(error); }
});

app.post("/v0/sessions/:id/duplicate", (_request, response) => {
  response.status(409).json({ error: "chat_duplication_deferred", message: "Chat duplication is unavailable while attachment ownership is unsettled." });
});

app.post("/v0/sessions/:id/move", async (request, response, next) => {
  try {
    const projectList = await projects.list();
    const context = await findChatContext(request.params.id);
    const session = await registry.find(projectList, request.params.id);
    const target = projectList.find((item) => item.id === request.body?.projectId || item.slug === request.body?.projectId);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    if (!target) return response.status(404).json({ error: "project_not_found" });
    if (context.chat.projectId === target.id) return response.status(409).json({ error: "session_project_unchanged" });
    await stopSessionProcesses(context.chat);
    const moved = session ? await moveSession(session, target) : null;
    await registry.move(context.chat.id, context.project, target);
    if (moved) await registry.commitSession(context.chat.id, moved);
    response.json(chatView(registry.metadata(context.chat.id)));
  } catch (error) { next(error); }
});

app.delete("/v0/sessions/:id", async (request, response, next) => {
  try {
    const context = await findChatContext(request.params.id);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    const session = await findRegisteredSession(request.params.id);
    await stopSessionProcesses(context.chat);
    if (session) await removeSession(session);
    await registry.remove(context.chat.id, context.project);
    response.status(204).end();
  } catch (error) { next(error); }
});

app.get("/v0/live-sessions", (_request, response) => response.json({ sessions: manager.list() }));
app.get("/v0/runtime/settings", (_request, response) => {
  response.json({ ...runtimeSettings.get(), ...manager.policy() });
});
app.patch("/v0/runtime/settings", async (request, response, next) => {
  try {
    const saved = await runtimeSettings.save({
      maxLiveProcesses: request.body?.maxLiveProcesses,
      maxGeneratingProcesses: request.body?.maxGeneratingProcesses,
      idleProcessTtlMs: request.body?.idleProcessTtlMs,
    });
    manager.configure(saved);
    await manager.enforceLimit();
    response.json({ ...saved, ...manager.policy() });
  } catch (error) { next(error); }
});
app.post("/v0/live-sessions", async (request, response, next) => {
  try {
    const chatId = request.body?.chatId || request.body?.resumeSessionId;
    const context = await findChatContext(chatId);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    const requestedProject = request.body?.projectId;
    if (requestedProject && ![context.project.id, context.project.slug].includes(requestedProject)) {
      return response.status(409).json({ error: "session_project_mismatch" });
    }
    const live = await manager.createWithCapacity({
      project: context.project,
      chatId: context.chat.id,
      sessionFile: context.chat.piSessionFile,
      model: request.body?.model || "",
      thinkingLevel: request.body?.thinkingLevel || "",
      models: modelCatalog.getLaunchModels(context.project.path),
    });
    await manager.waitForSession(live.id);
    if (context.chat.status === "draft") {
      await registry.update(context.chat.id, {
        piSessionId: live.sessionId || null,
        piSessionFile: live.sessionFile,
      });
    }
    response.status(201).json({ ...manager.view(live), streamUrl: `/v0/live-sessions/${live.id}/stream` });
  } catch (error) { next(error); }
});

app.get("/v0/live-sessions/:id/snapshot", async (request, response, next) => {
  try {
    const live = manager.get(request.params.id);
    if (!live) return response.status(404).json({ error: "live_session_not_found" });
    const persisted = live.chatId ? await findRegisteredSession(live.chatId) : null;
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
  let status = error.status || 500;
  if (error.code === "reserved_project") status = 409;
  if (error.code === "live_process_limit" || error.code === "generation_limit") status = 429;
  if (error.code === "attachment_not_found") status = 404;
  if (error.code === "invalid_attachment_id"
    || ["enabled_models_required", "invalid_enabled_model", "invalid_default_model"].includes(error.code)
    || error.message?.includes("Project names")) status = 400;
  response.status(status).json({ error: error.code || "runtime_error", message: error.message });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

async function promptForChat(record, command, message) {
  const context = await findChatContext(record.chatId);
  if (!context) throw new Error("Chat no longer exists");
  const selectedAttachments = await attachments.resolveMany(context.project, context.chat.id, command.attachmentIds);
  const prompt = serializeAttachmentEnvelope({ chatId: context.chat.id, attachments: selectedAttachments, message });
  return { context, prompt };
}

async function sendPrompt(record, prepared, options) {
  const generationId = manager.prompt(record.id, prepared.prompt, options);
  if (prepared.context.chat.status === "draft") {
    await registry.update(prepared.context.chat.id, {
      status: "active",
      piSessionId: record.sessionId || null,
      piSessionFile: record.sessionFile,
    });
  }
  return generationId;
}

async function syncForkedChat(record) {
  const context = await findChatContext(record.chatId);
  if (!context) throw new Error("Chat no longer exists");
  await registry.update(context.chat.id, {
    piSessionId: record.sessionId || context.chat.piSessionId,
    piSessionFile: record.sessionFile,
  });
  manager.publish(record, { type: "history_forked", chat: chatView(registry.metadata(context.chat.id)) });
  return registry.metadata(context.chat.id);
}

async function handleClientCommand(record, command) {
  if (command.type === "prompt") {
    const prepared = await promptForChat(record, command, String(command.message || ""));
    const streamingBehavior = command.streamingBehavior === "steer" || command.streamingBehavior === "followUp"
      ? command.streamingBehavior
      : null;
    return sendPrompt(record, prepared, { streamingBehavior });
  }
  if (command.type === "follow_up" || command.type === "steer") {
    const prepared = await promptForChat(record, command, String(command.message || ""));
    manager.send(record.id, {
      type: command.type,
      message: prepared.prompt,
    });
    return null;
  }
  if (command.type === "stop_generation" || command.type === "abort") {
    return manager.abortGeneration(record.id, command.generationId || null);
  }
  if (command.type === "fork_and_prompt") {
    await manager.fork(record.id, command.entryId);
    await syncForkedChat(record);
    const prepared = await promptForChat(record, command, String(command.message || ""));
    return sendPrompt(record, prepared);
  }
  if (command.type === "regenerate") {
    const forked = await manager.fork(record.id, command.entryId);
    await syncForkedChat(record);
    return manager.prompt(record.id, forked.text);
  }
  if (command.type === "continue") {
    if (!config.enablePartialContinue) throw Object.assign(new Error("Partial continuation is disabled"), { code: "partial_continue_disabled" });
    const persisted = await findRegisteredSession(record.chatId);
    const previous = persisted ? messagesFromEntries(persisted.entries).findLast((message) => message.role === "assistant") : null;
    const partial = previous?.content || record.generation?.partial || "";
    if (!partial || (!previous?.stopped && !record.generation?.closed)) throw new Error("There is no stopped response to continue");
    // Experimental and intentionally removable: this is an ordinary hidden user prompt, not assistant prefill.
    return manager.prompt(record.id, CONTINUE_PROMPT, { continuationBase: partial });
  }
  if (command.type === "extension_ui_response" || command.type === "host_ui_response") {
    manager.respondHostUi(record.id, command);
    return null;
  }
  if (command.type === "refresh_context") {
    return manager.refreshContextUsage(record.id);
  }
  manager.send(record.id, command);
  return null;
}

server.on("upgrade", (request, socket, head) => {
  const match = new URL(request.url, "http://localhost").pathname.match(/^\/v0\/live-sessions\/([a-f0-9]{24})\/stream$/);
  if (!match || !manager.get(match[1])) return socket.destroy();
  wss.handleUpgrade(request, socket, head, (ws) => {
    const record = manager.get(match[1]);
    manager.attach(match[1], ws);
    const turnStart = record.events.findLastIndex((event) => event.type === "agent_start");
    const generationOpen = record.generation
      && !record.generation.closed
      && !record.generation.settled;
    const pendingEvents = generationOpen && turnStart >= 0
      ? record.events.slice(turnStart).filter((event) => event.type !== "assistant_stream_delta")
      : [];
    const stream = record.stream
      ? { generationId: record.stream.generationId, content: record.stream.chunks.join("") }
      : null;
    if (record.status === "running" && !record.contextUsage?.contextWindow) {
      manager.refreshContextUsage(record.id).catch(() => {});
    }
    ws.send(JSON.stringify({
      type: "runtime_snapshot",
      session: manager.view(record),
      stream,
      events: pendingEvents,
      hostUiRequests: record.hostUiRequests || [],
      queue: record.queue || { steering: [], followUp: [] },
      contextUsage: record.contextUsage || null,
    }));
    ws.on("message", (data) => {
      Promise.resolve()
        .then(() => handleClientCommand(record, JSON.parse(String(data))))
        .catch((error) => ws.send(JSON.stringify({ type: "client_error", code: error.code, message: error.message })));
    });
  });
});

server.listen(config.port, config.host, () => console.log(`Conduit listening on http://${config.host}:${config.port}`));
