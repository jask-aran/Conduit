import { messagesFromEntries } from "../../session-store.js";
import { createLiveSessionLauncher } from "../live-session-launcher.js";

export function registerLiveSessionRoutes(app, {
  catalogFor,
  config,
  findChatContext,
  findRegisteredSession,
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
      const live = await launchLiveSession({
        chatId,
        requestedProject: request.body?.projectId || "",
        model: request.body?.model || "",
        thinkingLevel: request.body?.thinkingLevel || "",
      });
      response.status(201).json({ ...manager.view(live), streamUrl: `/v0/live-sessions/${live.id}/stream` });
    } catch (error) {
      next(error);
    }
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

  return launchLiveSession;
}
