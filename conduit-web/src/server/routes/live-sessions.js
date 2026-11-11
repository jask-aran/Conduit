import { createLiveSessionLauncher, enforceLiveProcessLimit, maySpawnProcess } from "../live-session-launcher.js";

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

  app.post("/v0/live-sessions", async (request, response) => {
    const chatId = request.body?.chatId || request.body?.resumeSessionId;
    const intent = request.body?.intent || "open";
    // The model a subagent's opener carries is not a change to it, so it is left behind rather than refused.
    const readOnly = registry.metadata(chatId)?.status === "subagent";
    if (readOnly && intent !== "open") return response.status(409).json({ error: "subagent_read_only" });
    const startedAt = Date.now();
    const { live, modelRecovery } = await launchLiveSession({
      chatId,
      requestedProject: request.body?.projectId || "",
      model: readOnly ? "" : request.body?.model || "",
      thinkingLevel: readOnly ? "" : request.body?.thinkingLevel || "",
      forceModel: intent === "prompt",
      attachOnly: !maySpawnProcess(intent),
    });
    const elapsed = Date.now() - startedAt;
    if (elapsed > 500) console.warn("Slow live-session launch", { chatId, intent, ms: elapsed });
    response.status(201).json({
      ...backends.view(live),
      streamUrl: `/v0/live-sessions/${live.id}/stream`,
      ...(modelRecovery ? { modelRecovery } : {}),
    });
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
