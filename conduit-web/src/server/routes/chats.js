import { resolveTemplate } from "../../config.js";
import { rememberModel } from "../../profile-model-memory.js";
import { chatView, isChatId } from "../../chat-store.js";
import { stopSessionProcesses } from "../../session-operations.js";
import { agentProfiles, conduitPiSessionFile, harnessCapabilities, profileSelection } from "../../chat-backend.js";
import { manifestForImplementation } from "../../harnesses/index.js";

const opaqueSessionId = (chat) => typeof chat.backend?.opaqueSession === "string"
  ? chat.backend.opaqueSession
  : chat.backend?.opaqueSession?.threadId || null;

export function projectBackendSessions({ chats, sessions, projectId, implementation }) {
  const backendChats = chats.filter((chat) => chat.backend?.implementation === implementation);
  const trackedIds = new Set(backendChats.map(opaqueSessionId).filter(Boolean));
  return {
    tracked: backendChats.filter((chat) => chat.projectId === projectId).map(chatView),
    adoptable: sessions.filter((session) => !trackedIds.has(session.id)),
  };
}

// A harness can be adopted from only if it enumerates threads on this machine
// and is actually installed. Returns the manifest so callers can stamp identity.
const discoverableFrom = (backends) => (implementation) => {
  const manifest = backends.manifestFor?.(implementation);
  if (!manifest || manifest.discovery === "none") return null;
  return backends.adapters.has(implementation) ? manifest : null;
};

export function registerChatRoutes(app, {
  backends,
  catalogFor,
  chatModelView,
  config,
  defaultTemplate,
  findChatContext,
  launchLiveSession,
  lifecycle,
  modelCatalog,
  preferences,
  projects,
  registry,
  runtimeFor,
  templateForChat,
}) {
  const discoverable = discoverableFrom(backends);
  const defaultDiscovery = () => backends.where((manifest) => manifest.discovery !== "none")[0] || "";
  const profileFor = (profileId) => agentProfiles(config.piTemplates, {
    available: new Set([...backends.adapters.keys()]),
  }).find((profile) => profile.id === profileId && profile.agent?.protocol === "native_api");
  const completeCreation = (request, response, chat, project) => {
    response.status(201).json(chatView(chat));
    if (request.body?.start !== true) return;
    void launchLiveSession({
      chatId: chat.id,
      requestedProject: project.id,
      model: request.body?.model || "",
      thinkingLevel: request.body?.thinkingLevel || "",
    }).catch((error) => console.error("Could not start new chat runtime", { chatId: chat.id, error }));
  };
  app.get("/v0/projects/:projectId/backend-sessions", async (request, response, next) => {
    try {
      const project = await projects.get(request.params.projectId);
      if (!project) return response.status(404).json({ error: "project_not_found" });
      await projects.validate(project);
      const implementation = String(request.query.implementation || defaultDiscovery());
      if (!discoverable(implementation)) {
        return response.status(409).json({ error: "backend_discovery_unavailable" });
      }
      const adapter = backends.forImplementation(implementation);
      const sessions = await adapter.listSessions({ cwd: project.workingRoot });
      const projection = projectBackendSessions({ chats: registry.list({ includeHidden: true }), sessions,
        projectId: project.id, implementation });
      response.json({ implementation, replayFidelity: "full",
        ...projection });
    } catch (error) { next(error); }
  });

  app.post("/v0/projects/:projectId/backend-sessions/:sessionId/adopt", async (request, response, next) => {
    try {
      const project = await projects.get(request.params.projectId);
      if (!project) return response.status(404).json({ error: "project_not_found" });
      await lifecycle.withProjects([project.id], async () => {
        await projects.validate(project);
        const implementation = String(request.query.implementation || defaultDiscovery());
        const manifest = discoverable(implementation);
        if (!manifest) return response.status(409).json({ error: "backend_discovery_unavailable" });
        const adapter = backends.forImplementation(implementation);
        const liveId = typeof request.body?.liveSessionId === "string" ? request.body.liveSessionId : "";
        const live = liveId ? adapter.get(liveId) : null;
        if (liveId && (!live || live.sessionId !== request.params.sessionId)) {
          return response.status(409).json({ error: "live_session_mismatch" });
        }
        const session = (await adapter.listSessions({ cwd: project.workingRoot }))
          .find((item) => item.id === request.params.sessionId);
        if (!session) return response.status(404).json({ error: "backend_session_not_found" });
        const alreadyTracked = registry.list({ includeHidden: true }).find((chat) =>
          chat.backend?.implementation === implementation && opaqueSessionId(chat) === session.id);
        if (alreadyTracked) return response.status(409).json({ error: "backend_session_already_tracked", chatId: alreadyTracked.id });
        const chat = await registry.create(project, { backend: {
          profileId: implementation, profileRevision: null, management: "agent", protocol: manifest.protocol,
          implementation, installationId: manifest.installationId, opaqueSession: { threadId: session.id },
        } });
        const timestamp = new Date().toISOString();
        await registry.update(chat.id, { status: "active", title: session.title,
          lastMessageAt: session.updatedAt || timestamp, updatedAt: timestamp });
        if (live) {
          adapter.track(live.id, chat.id);
          live.ephemeral = false;
        }
        response.status(201).json(chatView(registry.metadata(chat.id)));
      });
    } catch (error) { next(error); }
  });

  // Profiles say which harness they elect; harnesses say what they can do.
  app.get("/v0/profiles", (_request, response) => response.json({
    profiles: agentProfiles(config.piTemplates, { available: new Set([...backends.adapters.keys()]) }),
    harnesses: harnessCapabilities(),
  }));
  app.get("/v0/models", async (request, response, next) => {
    try {
      const project = await projects.get(request.query.projectId || "chat");
      if (!project) return response.status(404).json({ error: "project_not_found" });
      await projects.validate(project);
      if (request.query.refresh === "true") await modelCatalog.refreshFromNetwork();
      response.json({ installationId: "conduit-pinned", runtimeKind: "conduit_profile", ...await modelCatalog.list(project.workingRoot) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v0/settings", async (request, response, next) => {
    try {
      const project = await projects.get(request.query.projectId || "chat");
      if (!project) return response.status(404).json({ error: "project_not_found" });
      await projects.validate(project);
      response.json({ installationId: "conduit-pinned", runtimeKind: "conduit_profile", ...await modelCatalog.getSettings(project.workingRoot) });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/v0/settings", async (request, response, next) => {
    try {
      const project = await projects.get(request.body?.projectId || "chat");
      if (!project) return response.status(404).json({ error: "project_not_found" });
      await projects.validate(project);
      response.json({ installationId: "conduit-pinned", runtimeKind: "conduit_profile", ...await modelCatalog.updateSettings(project.workingRoot, request.body) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v0/chats", async (request, response, next) => {
    try {
      request.body = profileSelection(request.body);
      const project = await projects.get(request.body?.projectId || "chat");
      if (!project) return response.status(404).json({ error: "project_not_found" });
      await lifecycle.withProjects([project.id], async () => {
        await projects.validate(project);
        const selectedProfile = request.body?.profileId ? profileFor(request.body.profileId) : null;
        if (selectedProfile) {
          const profileId = request.body.profileId;
          if (selectedProfile.disabled || !backends.adapters.has(selectedProfile.agent.implementation)) {
            return response.status(409).json({ error: `${profileId}_unavailable` });
          }
          const chat = await registry.create(project, { backend: {
            profileId, profileRevision: null, management: selectedProfile.management,
            ...selectedProfile.agent, opaqueSession: null,
          } });
          return completeCreation(request, response, chat, project);
        }
        const requestedTemplateId = request.body?.templateId || project.defaultTemplateId || null;
        const template = requestedTemplateId
          ? resolveTemplate(config, requestedTemplateId)
          : defaultTemplate();
        if (!template) return response.status(400).json({ error: "unknown_template", templateId: requestedTemplateId });
        if (template.defaultable === false) return response.status(400).json({ error: "special_template", templateId: template.id });
        const runtimeKind = request.body?.runtimeKind || "conduit_profile";
        if (runtimeKind !== "conduit_profile") {
          return response.status(400).json({ error: "unknown_runtime_kind" });
        }
        const runtime = runtimeFor({ runtimeKind, template });
        const chat = await registry.create(project, {
          templateId: template.id,
          templateVersion: template.version,
          runtime,
        });
        completeCreation(request, response, chat, project);
      });
    } catch (error) { next(error); }
  });

  app.get("/v0/chats/:chatId", async (request, response, next) => {
    try {
      const context = await findChatContext(request.params.chatId);
      if (!context) return response.status(404).json({ error: "chat_not_found" });
      response.json(chatView(context.chat));
    } catch (error) { next(error); }
  });

  app.get("/v0/chats/:chatId/history", async (request, response, next) => {
    try {
      const context = await findChatContext(request.params.chatId);
      if (!context) return response.status(404).json({ error: "chat_not_found" });
      const adapter = backends.forChat(context.chat);
      const capabilities = adapter.getCapabilities();
      if (capabilities.history === "none") return response.status(409).json({ error: "chat_history_unavailable" });
      const resident = backends.getByChatId(context.chat.id);
      if (!resident && context.chat.status === "draft") return response.json({ leafId: null, tree: [] });
      response.json(await adapter.readHistory({
        liveSessionId: resident?.id,
        chatId: context.chat.id,
        opaqueSession: context.chat.backend?.opaqueSession,
        project: context.project,
      }));
    } catch (error) { next(error); }
  });

  app.get("/v0/chats/:chatId/permission-profiles", async (request, response, next) => {
    try {
      const context = await findChatContext(request.params.chatId);
      if (!context) return response.status(404).json({ error: "chat_not_found" });
      const adapter = backends.forChat(context.chat);
      if (!adapter.getCapabilities().permissionModes || typeof adapter.listPermissionModes !== "function"
        || typeof adapter.listAvailablePermissionModes !== "function") return response.json({ modes: [], selected: "" });
      const resident = backends.getByChatId(context.chat.id);
      const modes = resident
        ? await adapter.listPermissionModes(resident.id, context.project.workingRoot)
        : await adapter.listAvailablePermissionModes(context.project.workingRoot);
      const selected = resident?.permissionMode || context.chat.backend.permissionMode
        || (context.chat.backend.permissionProfile ? modes.find((mode) => mode.profile === context.chat.backend.permissionProfile)?.id : "")
        || (modes.some((mode) => mode.id === "custom") ? "custom" : modes[0]?.id) || "";
      response.json({ modes, selected });
    } catch (error) { next(error); }
  });

  app.patch("/v0/chats/:chatId/permission-profiles", async (request, response, next) => {
    try {
      await lifecycle.run(request.params.chatId, async () => {
        const context = await findChatContext(request.params.chatId);
        if (!context) return response.status(404).json({ error: "chat_not_found" });
        lifecycle.assertAvailable(context.chat.id, context.project.id);
        const adapter = backends.forChat(context.chat);
        if (!adapter.getCapabilities().permissionModes || typeof adapter.listPermissionModes !== "function"
          || typeof adapter.listAvailablePermissionModes !== "function" || typeof adapter.setPermissionMode !== "function") {
          return response.status(409).json({ error: "permission_profiles_unavailable" });
        }
        const resident = backends.getByChatId(context.chat.id);
        const modes = resident
          ? await adapter.listPermissionModes(resident.id, context.project.workingRoot)
          : await adapter.listAvailablePermissionModes(context.project.workingRoot);
        const selected = String(request.body?.permissionMode || "").trim();
        const mode = modes.find((candidate) => candidate.id === selected && candidate.allowed);
        if (!mode) return response.status(400).json({ error: "invalid_permission_mode" });
        if (resident) await adapter.setPermissionMode(resident.id, mode);
        const backend = { ...context.chat.backend, permissionMode: selected };
        if (mode.profile) backend.permissionProfile = mode.profile;
        else delete backend.permissionProfile;
        if (mode.approvalPolicy) backend.approvalPolicy = mode.approvalPolicy;
        else delete backend.approvalPolicy;
        if (mode.approvalsReviewer) backend.approvalsReviewer = mode.approvalsReviewer;
        else delete backend.approvalsReviewer;
        await registry.update(context.chat.id, { backend });
        response.json({ modes, selected });
      });
    } catch (error) { next(error); }
  });

  app.get("/v0/chats/:chatId/service-levels", async (request, response, next) => {
    try {
      const context = await findChatContext(request.params.chatId);
      if (!context) return response.status(404).json({ error: "chat_not_found" });
      const levels = manifestForImplementation(context.chat.backend?.implementation)?.serviceLevels || [];
      const resident = backends.getByChatId(context.chat.id);
      const selected = resident?.serviceLevel || context.chat.backend?.serviceLevel || levels[0]?.id || "";
      response.json({ levels, selected });
    } catch (error) { next(error); }
  });

  app.patch("/v0/chats/:chatId/service-levels", async (request, response, next) => {
    try {
      await lifecycle.run(request.params.chatId, async () => {
        const context = await findChatContext(request.params.chatId);
        if (!context) return response.status(404).json({ error: "chat_not_found" });
        lifecycle.assertAvailable(context.chat.id, context.project.id);
        const levels = manifestForImplementation(context.chat.backend?.implementation)?.serviceLevels || [];
        const selected = String(request.body?.serviceLevel || "").trim();
        if (!levels.some((level) => level.id === selected)) {
          return response.status(400).json({ error: "invalid_service_level" });
        }
        const resident = backends.getByChatId(context.chat.id);
        const adapter = backends.forChat(context.chat);
        if (resident) {
          if (typeof adapter.setServiceLevel !== "function") {
            return response.status(409).json({ error: "service_levels_unavailable" });
          }
          await adapter.setServiceLevel(resident.id, selected);
        }
        await registry.update(context.chat.id, {
          backend: { ...context.chat.backend, serviceLevel: selected },
        });
        response.json({ levels, selected });
      });
    } catch (error) { next(error); }
  });

  app.patch("/v0/chats/:chatId", async (request, response, next) => {
    try {
      await lifecycle.run(request.params.chatId, async () => {
      request.body = profileSelection(request.body);
      const context = await findChatContext(request.params.chatId);
      if (!context) return response.status(404).json({ error: "chat_not_found" });
      lifecycle.assertAvailable(context.chat.id, context.project.id);
      if (request.body?.profileId && context.chat.lastUserMessageAt) {
        return response.status(409).json({
          error: "backend_locked",
          message: "Fork this chat to change its backend.",
          fork: { required: true, profileId: request.body.profileId },
        });
      }
      const selectedProfile = request.body?.profileId ? profileFor(request.body.profileId) : null;
      if (selectedProfile) {
        const profileId = request.body.profileId;
        if (selectedProfile.disabled || !backends.adapters.has(selectedProfile.agent.implementation)) {
          return response.status(409).json({ error: `${profileId}_unavailable` });
        }
        const resident = backends.getByChatId(context.chat.id);
        if (resident) await backends.stop(resident.id);
        await registry.update(context.chat.id, {
          status: "draft",
          templateId: null,
          templateVersion: null,
          runtime: null,
          backend: { profileId, profileRevision: null, management: selectedProfile.management,
            ...selectedProfile.agent, opaqueSession: null },
        });
        return response.json(chatView(registry.metadata(context.chat.id)));
      }
      let selectedTemplate = templateForChat(context.chat, context.project);
      if (request.body?.templateId != null) {
        const currentTemplate = resolveTemplate(config, context.chat.templateId);
        if (currentTemplate?.special === true) {
          return response.status(409).json({ error: "special_chat_locked" });
        }
        if (context.chat.lastUserMessageAt) {
          return response.status(409).json({ error: "template_locked" });
        }
        const template = resolveTemplate(config, request.body.templateId);
        if (!template) {
          return response.status(400).json({ error: "unknown_template", templateId: request.body.templateId });
        }
        if (template.defaultable === false) {
          return response.status(400).json({ error: "special_template", templateId: template.id });
        }
        const resident = backends.getByChatId(context.chat.id);
        if (resident) await backends.stop(resident.id);
        await registry.update(context.chat.id, {
          status: "draft",
          templateId: template.id,
          templateVersion: template.version,
          backend: {
            profileId: template.id,
            profileRevision: template.version,
            management: "conduit",
            protocol: "pi_rpc",
            implementation: "conduit_pi",
            installationId: "conduit-pinned",
            opaqueSession: null,
          },
        });
        selectedTemplate = template;
      }
      if (request.body?.runtimeKind != null) {
        if (context.chat.lastUserMessageAt) {
          return response.status(409).json({ error: "runtime_locked" });
        }
        const runtimeKind = request.body.runtimeKind;
        if (runtimeKind !== "conduit_profile") {
          return response.status(400).json({ error: "unknown_runtime_kind" });
        }
        const runtime = runtimeFor({ runtimeKind, template: selectedTemplate });
        await registry.update(context.chat.id, { runtime });
      }
      response.json(chatView(registry.metadata(context.chat.id)));
      });
    } catch (error) { next(error); }
  });

  app.get("/v0/chats/:chatId/models", async (request, response, next) => {
    try {
      const context = await findChatContext(request.params.chatId);
      if (!context) return response.status(404).json({ error: "chat_not_found" });
      response.json(await chatModelView(context));
    } catch (error) { next(error); }
  });

  app.patch("/v0/chats/:chatId/models", async (request, response, next) => {
    try {
      await lifecycle.run(request.params.chatId, async () => {
      const context = await findChatContext(request.params.chatId);
      if (!context) return response.status(404).json({ error: "chat_not_found" });
      lifecycle.assertAvailable(context.chat.id, context.project.id);
      const spec = String(request.body?.model || "").trim();
      const thinkingLevel = String(request.body?.thinkingLevel || "").trim();
      const current = await chatModelView(context);
      if (spec && !current.models.some((item) => item.spec === spec && !item.outsideScope)) {
        return response.status(400).json({ error: "invalid_model" });
      }
      const targetModel = spec || current.model;
      const target = current.models.find((item) => item.spec === targetModel);
      if (thinkingLevel && target && !target.thinkingLevels.includes(thinkingLevel)) {
        return response.status(400).json({ error: "invalid_thinking_level" });
      }
      if (manifestForImplementation(context.chat.backend?.implementation)?.profile) {
        const implementation = context.chat.backend.implementation;
        const model = targetModel;
        const effort = thinkingLevel || context.chat.modelThinkingLevels?.[model]
          || target?.defaultThinkingLevel || target?.thinkingLevels[0] || "";
        const resident = backends.getByChatId(context.chat.id);
        if (resident) {
          const adapter = backends.forChat(context.chat);
          await adapter.setModel(resident.id, model);
          if (effort) await adapter.setThinkingLevel(resident.id, effort);
        }
        const modelThinkingLevels = effort
          ? { ...(context.chat.modelThinkingLevels || {}), [model]: effort }
          : context.chat.modelThinkingLevels || {};
        await registry.update(context.chat.id, {
          backend: { ...context.chat.backend, model }, modelThinkingLevels,
        });
        await rememberModel(preferences, implementation, model, effort);
        return response.json({ ...current, model, thinkingLevel: effort, modelThinkingLevels });
      }
      const saveThinkingPreference = async () => {
        if (!targetModel || !thinkingLevel) return context.chat;
        return registry.update(context.chat.id, {
          modelThinkingLevels: { ...(context.chat.modelThinkingLevels || {}), [targetModel]: thinkingLevel },
        });
      };
      const resident = backends.getByChatId(context.chat.id);
      if (resident) {
        const adapter = backends.forChat(context.chat);
        // Changing model is a live setting, not a relaunch. It used to restart
        // the agent whenever the new model resolved to a different search
        // overlay, because the overlay was materialised into the process at
        // launch; the harness does its own web access now, so there is nothing
        // to rebuild and nothing to restart.
        if (spec && spec !== current.model) await adapter.setModel(resident.id, spec);
        if (thinkingLevel) await adapter.setThinkingLevel(resident.id, thinkingLevel);
      } else {
        if (context.chat.status !== "draft" || conduitPiSessionFile(context.chat)) {
          return response.status(409).json({ error: "live_session_required" });
        }
        const template = templateForChat(context.chat, context.project);
        const runtime = context.chat.runtime || runtimeFor({ runtimeKind: "conduit_profile", template });
        if (spec) await catalogFor(runtime, template).updateDefault(context.project.workingRoot, spec, thinkingLevel);
      }
      await saveThinkingPreference();
      await rememberModel(preferences, templateForChat(context.chat, context.project)?.id, targetModel,
        thinkingLevel || context.chat.modelThinkingLevels?.[targetModel] || "");
      response.json(await chatModelView(context));
      });
    } catch (error) { next(error); }
  });

  app.post("/v0/runtime/chats", async (_request, response, next) => {
    try {
      const template = config.piTemplates.find((item) => item.special === true && item.id === "runtime");
      if (!template) return response.status(404).json({ error: "runtime_template_not_found" });
      const project = await projects.get("chat");
      if (!project) return response.status(404).json({ error: "project_not_found" });
      await lifecycle.withProjects([project.id], async () => {
        await projects.validate(project);
        const chat = await registry.create(project, {
          templateId: template.id,
          templateVersion: template.version,
          runtime: runtimeFor({ runtimeKind: "conduit_profile", template }),
        });
        response.status(201).json(chatView(chat));
      });
    } catch (error) { next(error); }
  });

  app.delete("/v0/chats/:chatId", async (request, response, next) => {
    try {
      if (request.query.ifEmpty !== "true") return response.status(409).json({ error: "use_chat_delete_route" });
      if (!isChatId(request.params.chatId)) return response.status(404).json({ error: "chat_not_found" });
      const removed = await lifecycle.deleteChat(request.params.chatId, async () => {
        const context = await findChatContext(request.params.chatId);
        if (!context) return null;
        return lifecycle.withProjects([context.project.id], async () => {
          await stopSessionProcesses(backends, context.chat);
          return registry.removeEmptyDraft(context.chat.id, context.project);
        });
      });
      if (removed == null) return response.status(404).json({ error: "chat_not_found" });
      response.status(removed ? 204 : 409).end();
    } catch (error) { next(error); }
  });
}
