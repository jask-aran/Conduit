import { createLiveSessionLauncher } from "../live-session-launcher.js";

export function registerLiveSessionRoutes(app, {
  backends,
  catalogFor,
  config,
  findChatContext,
  lifecycle,
  manager,
  modelProfileRuntime,
  nativePreflight,
  registry,
  runtimeFor,
  runtimeSettings,
  templateForChat,
}) {
  const launchLiveSession = createLiveSessionLauncher({
    backends,
    catalogFor,
    config,
    findChatContext,
    lifecycle,
    manager,
    modelProfileRuntime,
    nativePreflight,
    registry,
    runtimeFor,
    templateForChat,
  });
  app.get("/v0/live-sessions", (_request, response) => response.json({ sessions: backends.list() }));

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
      const { live, modelRecovery } = await launchLiveSession({
        chatId,
        requestedProject: request.body?.projectId || "",
        model: request.body?.model || "",
        thinkingLevel: request.body?.thinkingLevel || "",
      });
      response.status(201).json({
        ...backends.view(live),
        streamUrl: `/v0/live-sessions/${live.id}/stream`,
        ...(modelRecovery ? { modelRecovery } : {}),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v0/live-sessions/:id/snapshot", async (request, response, next) => {
    try {
      const live = backends.get(request.params.id);
      if (!live) return response.status(404).json({ error: "live_session_not_found" });
      const context = live.chatId ? await findChatContext(live.chatId) : null;
      const adapter = backends.adapterForRecord(live);
      const projection = await adapter.readTranscript({
        liveSessionId: live.id,
        chatId: live.chatId,
        project: context?.project,
      });
      response.json({ live: backends.view(live), events: live.events, ...projection });
    } catch (error) { next(error); }
  });

  // Model selection for a live record, not a chat. A driven harness thread has
  // no registry row, and the adapter already keys the model to the record the
  // prompt runs on, so this needs neither a chat nor a second app-server.
  const liveModelView = async (live) => {
    const adapter = backends.adapterForRecord(live);
    const models = adapter?.listModels ? await adapter.listModels(live.id) : [];
    return { models, model: live.model || "", thinkingLevel: live.thinkingLevel || "", modelThinkingLevels: {} };
  };

  app.get("/v0/live-sessions/:id/models", async (request, response, next) => {
    try {
      const live = backends.get(request.params.id);
      if (!live) return response.status(404).json({ error: "live_session_not_found" });
      response.json(await liveModelView(live));
    } catch (error) { next(error); }
  });

  // A driven thread has no Conduit chat, so its settled history cannot come from
  // /v0/sessions/:id. It comes from the adapter that is running the thread.
  app.get("/v0/live-sessions/:id/transcript", async (request, response, next) => {
    try {
      const live = backends.get(request.params.id);
      if (!live) return response.status(404).json({ error: "live_session_not_found" });
      const adapter = backends.adapterForRecord(live);
      const transcript = await adapter.readTranscript({ liveSessionId: live.id, chatId: live.chatId });
      response.json({ id: live.chatId || live.id, status: "active", ...transcript, attachments: [], page: { before: null } });
    } catch (error) { next(error); }
  });

  app.patch("/v0/live-sessions/:id/models", async (request, response, next) => {
    try {
      const live = backends.get(request.params.id);
      if (!live) return response.status(404).json({ error: "live_session_not_found" });
      const adapter = backends.adapterForRecord(live);
      const current = await liveModelView(live);
      const spec = String(request.body?.model || "").trim();
      const thinkingLevel = String(request.body?.thinkingLevel || "").trim();
      if (spec && !current.models.some((item) => item.spec === spec)) {
        return response.status(400).json({ error: "invalid_model" });
      }
      const targetModel = spec || current.model;
      const target = current.models.find((item) => item.spec === targetModel);
      if (thinkingLevel && target && target.thinkingLevels.length && !target.thinkingLevels.includes(thinkingLevel)) {
        return response.status(400).json({ error: "invalid_thinking_level" });
      }
      if (spec) await adapter.setModel(live.id, spec);
      if (thinkingLevel) await adapter.setThinkingLevel(live.id, thinkingLevel);
      response.json({ ...current, model: targetModel, thinkingLevel: thinkingLevel || current.thinkingLevel });
    } catch (error) { next(error); }
  });

  app.delete("/v0/live-sessions/:id/process", (request, response) => {
    const stopped = backends.stop(request.params.id);
    response.status(stopped ? 202 : 404).json({ stopped });
  });

  return launchLiveSession;
}
