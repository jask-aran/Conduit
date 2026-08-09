import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { isChatId } from "../../chat-store.js";
import { messagesFromEntries, validateSessionHeader } from "../../session-store.js";
import { resolvePiLaunch } from "../../pi-launch.js";

export function registerLiveSessionRoutes(app, {
  catalogFor,
  config,
  findChatContext,
  findRegisteredSession,
  lifecycle,
  manager,
  nativePreflight,
  registry,
  runtimeFor,
  runtimeSettings,
  templateForChat,
}) {
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
    let launchedRecord = null;
    try {
      const chatId = request.body?.chatId || request.body?.resumeSessionId;
      if (!isChatId(chatId)) return response.status(404).json({ error: "chat_not_found" });
      await lifecycle.runLaunch(chatId, async () => {
        const context = await findChatContext(chatId);
        if (!context) return response.status(404).json({ error: "chat_not_found" });
        await lifecycle.withProjects([context.project.id], async () => {
          lifecycle.assertAvailable(context.chat.id, context.project.id);
          const requestedProject = request.body?.projectId;
          if (requestedProject && ![context.project.id, context.project.slug].includes(requestedProject)) {
            return response.status(409).json({ error: "session_project_mismatch" });
          }
          const resident = manager.getByChatId(context.chat.id);
          if (resident) {
            return response.status(201).json({ ...manager.view(resident), streamUrl: `/v0/live-sessions/${resident.id}/stream` });
          }
          const template = templateForChat(context.chat, context.project);
          const runtime = context.chat.runtime || runtimeFor({ runtimeKind: "conduit_profile", template });
          const installation = config.installations.get(runtime.installationId);
          if (!installation) {
            return response.status(409).json({ error: "runtime_unavailable", installationId: runtime.installationId });
          }
          if (context.chat.piSessionFile) {
            try { await validateSessionHeader(context.chat.piSessionFile, context.project); }
            catch (error) {
              if (error.code === "ENOENT") context.chat.piSessionFile = null;
              else return response.status(409).json({ error: "session_file_unavailable", message: error.message });
            }
          }
          if (runtime.kind === "native_pi") {
            const preflight = await nativePreflight(context.project);
            if (!preflight.available) return response.status(409).json({ error: "native_pi_unavailable", message: preflight.error });
            new ProjectTrustStore(installation.agentDir).set(context.project.path, true);
          }
          const seedModel = context.chat.piSessionFile ? "" : request.body?.model || "";
          const seedThinkingLevel = context.chat.piSessionFile ? "" : request.body?.thinkingLevel || "";
          const runtimeCatalog = catalogFor(runtime, template);
          if (seedModel) {
            const allowed = await runtimeCatalog.list(context.project.path);
            if (!allowed.models.some((model) => model.spec === seedModel)) {
              return response.status(400).json({ error: "invalid_model" });
            }
          }
          const launchSpec = resolvePiLaunch({
            chat: context.chat,
            project: context.project,
            installation,
            template: runtime.kind === "conduit_profile" ? template : null,
            models: runtime.kind === "conduit_profile" ? runtimeCatalog.getLaunchModels(context.project.path) : null,
            model: seedModel,
            thinkingLevel: seedThinkingLevel,
            bridgeSystemPrompt: config.bridgeSystemPrompt,
            bridgeSkill: config.bridgeSkill,
          });
          console.info("Launching Pi", {
            chatId: context.chat.id,
            projectId: context.project.id,
            runtimeKind: runtime.kind,
            installationId: installation.id,
            binaryVersion: installation.version,
            profileId: runtime.profileId,
            profileVersion: runtime.profileVersion,
            cwd: launchSpec.cwd,
            sessionFile: launchSpec.sessionFile,
            trustPosture: launchSpec.trustPosture,
          });
          lifecycle.assertAvailable(context.chat.id, context.project.id);
          const live = await manager.createWithCapacity({
            project: context.project,
            chatId: context.chat.id,
            sessionFile: context.chat.piSessionFile,
            model: seedModel,
            thinkingLevel: seedThinkingLevel,
            template: runtime.kind === "conduit_profile" ? template : null,
            launchSpec,
          });
          launchedRecord = live;
          await manager.waitForSession(live.id);
          lifecycle.assertAvailable(context.chat.id, context.project.id);
          if (runtime.kind === "native_pi" && seedModel) {
            await manager.setModel(live.id, seedModel);
            if (seedThinkingLevel) await manager.setThinkingLevel(live.id, seedThinkingLevel);
          }
          if (!live.sessionFile) throw Object.assign(new Error("Pi did not report a session file"), { code: "invalid_session_mapping" });
          const mapping = {
            templateId: template.id,
            templateVersion: template.version,
            runtime: {
              ...runtime,
            },
          };
          if (context.chat.status === "draft") {
            mapping.piSessionId = live.sessionId || null;
            mapping.piSessionFile = live.sessionFile;
          }
          await registry.update(context.chat.id, mapping);
          response.status(201).json({ ...manager.view(live), streamUrl: `/v0/live-sessions/${live.id}/stream` });
        });
      });
    } catch (error) {
      if (launchedRecord && ["starting", "running"].includes(launchedRecord.status)) {
        await manager.stopAndWait(launchedRecord.id).catch(() => {});
      }
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
}
