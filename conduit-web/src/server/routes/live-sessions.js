import { createLiveSessionLauncher, enforceLiveProcessLimit, maySpawnProcess } from "../live-session-launcher.js";
import { rememberModel } from "../../profile-model-memory.js";

export function registerLiveSessionRoutes(app, {
  attachments,
  backends,
  catalogFor,
  config,
  concurrency,
  findChatContext,
  lifecycle,
  preferences,
  registry,
  runtimeFor,
  runtimeSettings,
  templateForChat,
  promptChat,
}) {
  const launchLiveSession = createLiveSessionLauncher({
    backends,
    catalogFor,
    config,
    concurrency,
    findChatContext,
    lifecycle,
    maxLiveProcesses: () => runtimeSettings.get().maxLiveProcesses,
    preferences,
    registry,
    runtimeFor,
    templateForChat,
  });
  app.get("/v0/live-sessions", (_request, response) => response.json({ sessions: backends.list() }));

  const runtimeView = () => ({
    ...runtimeSettings.get(),
    liveCount: backends.rawRecords().filter((record) => backends.view(record).status !== "stopped").length,
    generatingCount: backends.generatingRecords().length,
  });

  app.get("/v0/runtime/settings", (_request, response) => {
    response.json(runtimeView());
  });

  app.patch("/v0/runtime/settings", async (request, response) => {
    const saved = await runtimeSettings.save({
      maxLiveProcesses: request.body?.maxLiveProcesses,
      maxGeneratingProcesses: request.body?.maxGeneratingProcesses,
    });
    await enforceLiveProcessLimit(backends, saved.maxLiveProcesses);
    response.json(runtimeView());
  });

  // A first message the browser could not send over the chat's stream: it left the chat while the agent was starting.
  // Started here if it is not yet (with the composer's model), then sent as the stream would have sent it.
  app.post("/v0/chats/:chatId/prompt", async (request, response) => {
    const chatId = request.params.chatId;
    const message = typeof request.body?.message === "string" ? request.body.message : "";
    const attachmentIds = Array.isArray(request.body?.attachmentIds) ? request.body.attachmentIds : [];
    if (!message.trim() && !attachmentIds.length) return response.status(400).json({ error: "empty_prompt" });
    if (registry.metadata(chatId)?.status === "subagent") return response.status(409).json({ error: "subagent_read_only" });
    // The browser's own launch may still be under way: the prompt waits for it rather than racing it with settings
    // of its own (a launch with other settings is refused while one runs).
    await lifecycle.launches?.get(chatId)?.promise.catch(() => {});
    if (!backends.getByChatId(chatId)) {
      await launchLiveSession({ chatId, requestedProject: request.body?.projectId || "", model: request.body?.model || "",
        thinkingLevel: request.body?.thinkingLevel || "", forceModel: true });
    }
    const generationId = await promptChat(chatId, { messageId: request.body?.messageId, message, attachmentIds });
    response.status(202).json({ chatId, generationId: generationId || null });
  });

  app.post("/v0/live-sessions", async (request, response, next) => {
    try {
      const chatId = request.body?.chatId || request.body?.resumeSessionId;
      const intent = request.body?.intent || "open";
      // A subagent's chat only opens to be read: the model the opener carries (the pane's choice) is not a change to
      // it, so it is left behind rather than refused.
      const readOnly = registry.metadata(chatId)?.status === "subagent";
      if (readOnly && intent !== "open") return response.status(409).json({ error: "subagent_read_only" });
      // A launch that keeps somebody waiting says so, with the chat and intent
      // that asked for it, so a slow open can be read from the log instead of
      // reproduced.
      const startedAt = Date.now();
      const { live, modelRecovery } = await launchLiveSession({
        chatId,
        requestedProject: request.body?.projectId || "",
        model: readOnly ? "" : request.body?.model || "",
        thinkingLevel: readOnly ? "" : request.body?.thinkingLevel || "",
        forceModel: intent === "prompt",
        // Only real use starts a process. An "open" attaches to one that is
        // already there and otherwise gets told there is none.
        attachOnly: !maySpawnProcess(intent),
      });
      const elapsed = Date.now() - startedAt;
      if (elapsed > 500) console.warn("Slow live-session launch", { chatId, intent, ms: elapsed });
      response.status(201).json({
        ...backends.view(live),
        streamUrl: `/v0/live-sessions/${live.id}/stream`,
        ...(modelRecovery ? { modelRecovery } : {}),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v0/live-sessions/:id/snapshot", async (request, response) => {
    const live = backends.get(request.params.id);
    if (!live) return response.status(404).json({ error: "live_session_not_found" });
    const context = live.chatId ? await findChatContext(live.chatId) : null;
    const adapter = backends.adapterForRecord(live);
    const projection = await adapter.readTranscript({
      liveSessionId: live.id,
      chatId: live.chatId,
      opaqueSession: context?.chat?.backend?.opaqueSession,
      project: context?.project,
    });
    if (context) {
      projection.messages = await attachments.decorateMessages(context.project, context.chat.id, projection.messages);
    }
    response.json({ live: backends.view(live), events: live.events, ...projection });
  });

  // Model selection for a live record, not a chat. A driven harness thread has
  // no registry row, and the adapter already keys the model to the record the
  // prompt runs on, so this needs neither a chat nor a second app-server.
  const liveModelView = async (live) => {
    const adapter = backends.adapterForRecord(live);
    const models = adapter?.listModels ? await adapter.listModels(live.id) : [];
    return { models, model: live.model || "", thinkingLevel: live.thinkingLevel || "", modelThinkingLevels: {} };
  };

  app.get("/v0/live-sessions/:id/models", async (request, response) => {
    const live = backends.get(request.params.id);
    if (!live) return response.status(404).json({ error: "live_session_not_found" });
    response.json(await liveModelView(live));
  });

  app.get("/v0/live-sessions/:id/commands", async (request, response) => {
    const live = backends.get(request.params.id);
    if (!live) return response.status(404).json({ error: "live_session_not_found" });
    const commands = await backends.adapterForRecord(live).listCommands(live.id);
    response.json({ commands });
  });

  // A driven thread has no Conduit chat, so its settled history cannot come from
  // /v0/sessions/:id. It comes from the adapter that is running the thread.
  app.get("/v0/live-sessions/:id/transcript", async (request, response) => {
    const live = backends.get(request.params.id);
    if (!live) return response.status(404).json({ error: "live_session_not_found" });
    const adapter = backends.adapterForRecord(live);
    const transcript = await adapter.readTranscript({ liveSessionId: live.id, chatId: live.chatId });
    if (live.chatId) {
      const context = await findChatContext(live.chatId);
      if (context) {
        transcript.messages = await attachments.decorateMessages(context.project, context.chat.id, transcript.messages);
      }
    }
    response.json({ id: live.chatId || live.id, status: "active", ...transcript, attachments: [], page: { before: null } });
  });

  app.patch("/v0/live-sessions/:id/models", async (request, response) => {
    const child = backends.get(request.params.id);
    if (child && (child.readOnly || registry.metadata(child.chatId)?.status === "subagent")) {
      return response.status(409).json({ error: "subagent_read_only" });
    }
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
    // Driving a harness thread is still choosing on that profile.
    await rememberModel(preferences, live.adapterImplementation, targetModel,
      thinkingLevel || current.thinkingLevel || "");
    response.json({ ...current, model: targetModel, thinkingLevel: thinkingLevel || current.thinkingLevel });
  });

  app.delete("/v0/live-sessions/:id/process", async (request, response) => {
    const child = backends.get(request.params.id);
    if (child && (child.readOnly || registry.metadata(child.chatId)?.status === "subagent")) {
      return response.status(409).json({ error: "subagent_read_only" });
    }
    const stopped = await backends.stop(request.params.id);
    response.status(stopped ? 202 : 404).json({ stopped });
  });

  return launchLiveSession;
}
