import { entriesToOps } from "../../durable-adapter.js";
import { applyTranscriptOps } from "../../transcript-fold.js";
import { ConduitIds } from "../durable-runtime.js";
import fs from "node:fs/promises";
import { resolveTemplate } from "../../config.js";
import { rememberModel } from "../../profile-model-memory.js";
import { chatView, isChatId } from "../../chat-store.js";
import { resolveComputerContext } from "../../computer-context.js";
import { stopSessionProcesses } from "../../session-operations.js";
import { agentProfiles, harnessCapabilities, profileSelection, templateBackend } from "../../chat-backend.js";
import { manifestForImplementation } from "../../harnesses/index.js";

export function registerChatRoutes(app, {
  nodeHub = null,
  announceChat = null,
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
  templateForChat,
}) {
  const durable = backends.adapters?.get("conduit-runtime");
  if (durable) durable.runtime.ensureSubagent = async (parentConversationId, agent) => {
    const harness = await durable.runtime.open();
    const identity = await harness.snapshot(ConduitIds, parentConversationId, durable.context);
    const parent = identity?.chatId && await findChatContext(identity.chatId);
    if (!parent) return null;
    const child = await registry.ensureSubagent(parent.project, parent.chat, agent);
    const conversation = await harness.conversation(Number(agent.conversationId), durable.context);
    if (conversation) {
      const saved = await harness.snapshot(ConduitIds, conversation.id, durable.context);
      if (saved?.chatId !== child.id || !saved?.subagent || saved?.parentChatId !== parent.chat.id) await conversation.commit(async (tx) => {
        Object.assign(await tx.doc(ConduitIds, conversation.id), { chatId: child.id, subagent: true, parentChatId: parent.chat.id });
      }, durable.context);
    }
    // Its reader starts when the chat is opened (launch), as any chat's does.
    return child;
  };

  // Work submitted to a conversation from the server is followed by its chat, as `reattach` does at startup, so it
  // reaches the chat's log and anyone who opens it.
  if (durable) durable.runtime.wakeChat = (conversationId) => void (async () => {
    const harness = await durable.runtime.open();
    const chatId = (await harness.snapshot(ConduitIds, conversationId, durable.context))?.chatId;
    if (!chatId || backends.getByChatId(chatId) || !registry.metadata(chatId)) return;
    await launchLiveSession({ chatId });
  })().catch((error) => { if (error?.code !== "live_process_limit") console.warn("[conduit-runtime] could not follow", conversationId, error?.message || error); });

  // Param guards also cover upload and draft routes registered before these routes.
  const childWrite = (request, response, next, id) => {
    if (/^\/v0\/(?:chats|sessions|runs)\//.test(request.originalUrl)
      && !["GET", "HEAD"].includes(request.method) && registry?.metadata(id)?.status === "subagent") {
      return response.status(409).json({ error: "subagent_read_only" });
    }
    next();
  };
  app.param("chatId", childWrite);
  app.param("id", childWrite);

  const lastReply = (messages) => messages.findLast((message) => message.role === "assistant"
    && !message.streaming && typeof message.content === "string" && message.content.trim());
  const latestReply = async (chat, project) => {
    const adapter = backends.forChat(chat);
    let reply;
    if (chat.backend?.implementation === "conduit-runtime") {
      const id = Number(chat.backend.opaqueSession);
      if (!Number.isSafeInteger(id) || id <= 0) return null;
      const harness = await adapter.runtime.open();
      const conversation = await harness.conversation(id, adapter.context);
      if (!conversation) return null;
      let cursor;
      // Read backward in bounded pages; never reconstruct the whole conversation.
      do {
        const page = await conversation.entries({ order: "descending" }, 100, cursor, adapter.context);
        reply = lastReply(applyTranscriptOps({}, entriesToOps([...page.items].reverse()
          .filter((entry) => entry.kind === "pi.assistant"))).messages);
        cursor = page.next;
      } while (!reply && cursor);
    } else {
      let before;
      const cursors = new Set();
      do {
        const projection = await adapter.readTranscript({ chatId: chat.id,
          liveSessionId: backends.getByChatId(chat.id)?.id,
          opaqueSession: chat.backend?.opaqueSession, project, before });
        reply = lastReply(projection.messages || []);
        before = projection.page?.before;
        if (cursors.has(before)) break;
        cursors.add(before);
      } while (!reply && before);
    }
    return reply ? { text: reply.content.slice(0, 2000), at: reply.timestamp || chat.lastAssistantCompletedAt || null } : null;
  };

  app.get("/v0/chats/recent", async (request, response) => {
    const limit = Math.min(50, Math.max(1, Math.trunc(Number(request.query.limit) || 20)));
    const places = new Map((await projects.list()).map((project) => [project.id, project]));
    const live = new Map(backends.list().map((process) => [process.chatId, process]));
    const sort = preferences?.get().chatSort === "created" ? "created" : "latest";
    // Match the dashboard/sidebar comparator, including numeric timestamps.
    const activity = (chat) => {
      const value = sort === "created" ? chat.createdAt : chat.lastMessageAt || chat.createdAt;
      if (typeof value === "string") return value;
      if (typeof value !== "number" || !Number.isFinite(value)) return "";
      const date = new Date(value < 1_000_000_000_000 ? value * 1_000 : value);
      return Number.isNaN(date.getTime()) ? "" : date.toISOString();
    };
    const chats = registry.list().filter((chat) => chat.status === "active" && !chat.untracked && places.has(chat.projectId))
      .sort((a, b) => activity(b).localeCompare(activity(a)) || b.id.localeCompare(a.id)).slice(0, limit);
    response.set("Cache-Control", "no-store");
    const results = new Array(chats.length);
    let nextIndex = 0;
    await Promise.all(Array.from({ length: Math.min(4, chats.length) }, async () => {
      while (nextIndex < chats.length) {
        const index = nextIndex++;
        const chat = chats[index];
        results[index] = {
          chatId: chat.id, title: chat.title || "", projectId: chat.projectId,
          projectName: places.get(chat.projectId).name, lastMessageAt: chat.lastMessageAt || null,
          liveStatus: live.get(chat.id)?.status || null,
          latestReply: await latestReply(chat, places.get(chat.projectId)),
        };
      }
    }));
    response.json({ chats: results });
  });

  app.get("/v0/chats/:chatId/agents", async (request, response) => {
    await lifecycle.run(request.params.chatId, async () => {
      const context = await findChatContext(request.params.chatId);
      if (!context) return response.status(404).json({ error: "chat_not_found" });
      const adapter = backends.forChat(context.chat);
      response.json({ agents: typeof adapter.agents === "function" ? await adapter.agents(context.chat) : [] });
    });
  });

  app.post("/v0/chats/:chatId/agents/:id/stop", async (request, response) => {
    await lifecycle.run(request.params.chatId, async () => {
      const context = await findChatContext(request.params.chatId);
      if (!context) return response.status(404).json({ error: "chat_not_found" });
      const adapter = backends.forChat(context.chat);
      if (!adapter.stopAgent || !await adapter.stopAgent(context.chat, request.params.id)) {
        return response.status(409).json({ error: "agent_not_running" });
      }
      response.status(204).end();
    });
  });

  const profileFor = (profileId) => agentProfiles(config.piTemplates, {
    available: new Set([...(backends.local || backends.adapters.keys())]),
  }).find((profile) => profile.id === profileId && profile.management === "agent");
  const completeCreation = (request, response, chat, project, { start = false } = {}) => {
    response.status(201).json(chatView(chat));
    announceChat?.(chatView(chat));
    if (request.body?.start !== true && !start) return;
    void launchLiveSession({
      chatId: chat.id,
      requestedProject: project.id,
      model: request.body?.model || "",
      thinkingLevel: request.body?.thinkingLevel || "",
      spare: request.body?.start !== true,
    }).catch((error) => {
      if (error.code !== "live_process_limit") console.error("Could not start new chat runtime", { chatId: chat.id, error });
    });
  };
  app.post("/v0/chats/:chatId/track", async (request, response) => {
    const context = await findChatContext(request.params.chatId);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    if (!context.chat.untracked) return response.json(chatView(context.chat));
    const project = await projects.get(String(request.body?.projectId || ""));
    const real = (root) => fs.realpath(root).catch(() => root);
    const roots = project && await Promise.all([real(project.workingRoot), real(context.project.workingRoot)]);
    if (!roots || roots[0] !== roots[1]) {
      return response.status(400).json({ error: "workspace_mismatch" });
    }
    await registry.update(context.chat.id, { untracked: false, projectId: project.id });
    response.json(chatView(registry.metadata(context.chat.id)));
  });

  app.get("/v0/profiles", (_request, response) => response.json({
    profiles: agentProfiles(config.piTemplates, { available: new Set([...(backends.local || backends.adapters.keys())]) }),
    harnesses: harnessCapabilities(),
  }));
  app.get("/v0/usage", async (request, response) => {
    const runtime = backends.adapters.get("conduit-runtime")?.runtime;
    if (!runtime) return response.status(404).json({ error: "runtime_unavailable" });
    await runtime.open();
    if (!runtime.usage) return response.status(503).json({ error: "usage_unavailable" });
    const days = Math.min(366, Math.max(1, Number.parseInt(String(request.query.days || "30"), 10) || 30));
    response.json(runtime.usage.view(days));
  });
  app.get("/v0/profiles/tools", async (_request, response) => {
    const runtime = backends.adapters.get("conduit-runtime")?.runtime;
    if (!runtime) return response.status(404).json({ error: "runtime_unavailable" });
    response.json({ profiles: await runtime.toolsView() });
  });
  const placeFor = async (id) => {
    const project = await projects.get(id || "chat");
    if (!project) return resolveComputerContext(String(id || "")).catch(() => null);
    await projects.validate(project);
    return project;
  };
  app.get("/v0/models", async (request, response) => {
    const project = await placeFor(request.query.projectId);
    if (!project) return response.status(404).json({ error: "project_not_found" });
    if (request.query.refresh === "true") await modelCatalog.refreshFromNetwork();
    response.json({ installationId: "conduit-pinned", runtimeKind: "conduit_profile", ...await modelCatalog.list(project.workingRoot) });
  });

  app.get("/v0/settings", async (request, response) => {
    const project = await placeFor(request.query.projectId);
    if (!project) return response.status(404).json({ error: "project_not_found" });
    response.json({ installationId: "conduit-pinned", runtimeKind: "conduit_profile", ...await modelCatalog.getSettings(project.workingRoot) });
  });

  app.patch("/v0/settings", async (request, response) => {
    const project = await projects.get(request.body?.projectId || "chat");
    if (!project) return response.status(404).json({ error: "project_not_found" });
    await projects.validate(project);
    response.json({ installationId: "conduit-pinned", runtimeKind: "conduit_profile", ...await modelCatalog.updateSettings(project.workingRoot, request.body) });
  });

  app.post("/v0/chats", async (request, response) => {
    request.body = profileSelection(request.body);
    const project = await projects.get(request.body?.projectId || "chat");
    if (!project) return response.status(404).json({ error: "project_not_found" });
    await lifecycle.withProjects([project.id], async () => {
      await projects.validate(project);
      const can = await backends.capabilities?.(project);
      const offered = (implementation) => !can || can.harnesses.includes(implementation);
      const selectedProfile = request.body?.profileId ? profileFor(request.body.profileId) : null;
      const implementation = selectedProfile?.agent.implementation || "conduit-runtime";
      if (!offered(implementation)) {
        return response.status(409).json({ error: "harness_not_here",
          message: `${selectedProfile?.label || config.piTemplates.find((item) => item.id === request.body?.profileId)?.label || "That profile"} is not available on ${can.device.name}` });
      }
      if (selectedProfile) {
        const profileId = request.body.profileId;
        if ((!can && selectedProfile.disabled) || !backends.adapters.has(selectedProfile.agent.implementation)) {
          return response.status(409).json({ error: `${profileId}_unavailable` });
        }
        const chat = await registry.create(project, { backend: {
          profileId, profileRevision: null, management: selectedProfile.management,
          ...selectedProfile.agent, opaqueSession: null,
        } });
        return completeCreation(request, response, chat, project, { start: request.body?.warm === true });
      }
      const requestedTemplateId = request.body?.templateId || project.defaultTemplateId || null;
      const template = requestedTemplateId
        ? resolveTemplate(config, requestedTemplateId)
        : defaultTemplate();
      if (!template) return response.status(400).json({ error: "unknown_template", templateId: requestedTemplateId, message: `Unknown profile: ${requestedTemplateId}` });
      if (template.defaultable === false) return response.status(400).json({ error: "special_template", templateId: template.id });
      const roaming = request.body?.roaming === true && project.local;
      const chat = await registry.create(project, {
        templateId: template.id,
        templateVersion: template.version,
        backend: { ...templateBackend(template), ...(roaming ? { roaming: true } : {}) },
      });
      completeCreation(request, response, chat, project, { start: request.body?.warm === true });
    });
  });

  app.get("/v0/chats/:chatId", async (request, response) => {
    const context = await findChatContext(request.params.chatId);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    response.json(chatView(context.chat));
  });

  app.post("/v0/chats/:chatId/reset", async (request, response) => {
    const context = await findChatContext(request.params.chatId);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    const adapter = backends.forChat(context.chat);
    if (typeof adapter.reset !== "function") return response.status(409).json({ error: "reset_unsupported" });
    await adapter.reset({ liveSessionId: backends.getByChatId(context.chat.id)?.id,
      opaqueSession: context.chat.backend?.opaqueSession, handoff: request.body?.handoff });
    response.json({ ok: true });
  });

  app.get("/v0/chats/:chatId/history", async (request, response) => {
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
  });

  app.get("/v0/chats/:chatId/commands", async (request, response) => {
    const context = await findChatContext(request.params.chatId);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    const adapter = backends.forChat(context.chat);
    const resident = backends.getByChatId(context.chat.id);
    const commands = resident
      ? await adapter.listCommands(resident.id)
      : await adapter.listAvailableCommands({
        cwd: context.project.workingRoot,
        template: templateForChat(context.chat, context.project),
      });
    response.json({ commands });
  });

  app.get("/v0/chats/:chatId/permission-profiles", async (request, response) => {
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
  });

  app.patch("/v0/chats/:chatId/permission-profiles", async (request, response) => {
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
  });

  app.get("/v0/chats/:chatId/service-levels", async (request, response) => {
    const context = await findChatContext(request.params.chatId);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    const levels = manifestForImplementation(context.chat.backend?.implementation)?.serviceLevels || [];
    const resident = backends.getByChatId(context.chat.id);
    const selected = resident?.serviceLevel || context.chat.backend?.serviceLevel || levels[0]?.id || "";
    response.json({ levels, selected });
  });

  app.patch("/v0/chats/:chatId/service-levels", async (request, response) => {
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
  });

  app.patch("/v0/chats/:chatId", async (request, response) => {
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
      const can = await backends.capabilities?.(context.project);
      if ((can ? !can.harnesses.includes(selectedProfile.agent.implementation) : selectedProfile.disabled)
        || !backends.adapters.has(selectedProfile.agent.implementation)) {
        return response.status(409).json({ error: `${profileId}_unavailable`,
          ...(can ? { message: `${selectedProfile.label} is not available on ${can.device.name}` } : {}) });
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
        return response.status(400).json({ error: "unknown_template", templateId: request.body.templateId, message: `Unknown profile: ${request.body.templateId}` });
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
        backend: templateBackend(template),
      });
    }
    response.json(chatView(registry.metadata(context.chat.id)));
    });
  });

  app.get("/v0/chats/:chatId/models", async (request, response) => {
    const context = await findChatContext(request.params.chatId);
    if (!context) return response.status(404).json({ error: "chat_not_found" });
    response.json(await chatModelView(context));
  });

  app.patch("/v0/chats/:chatId/models", async (request, response) => {
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
      const modelThinkingLevels = targetModel && thinkingLevel
        ? { ...(context.chat.modelThinkingLevels || {}), [targetModel]: thinkingLevel }
        : context.chat.modelThinkingLevels || {};
      return registry.update(context.chat.id, {
        backend: targetModel ? { ...context.chat.backend, model: targetModel } : context.chat.backend,
        modelThinkingLevels,
      });
    };
    const resident = backends.getByChatId(context.chat.id);
    if (resident) {
      const adapter = backends.forChat(context.chat);
      // Changing model is a live setting, not a relaunch.
      if (spec && spec !== current.model) await adapter.setModel(resident.id, spec);
      if (thinkingLevel) await adapter.setThinkingLevel(resident.id, thinkingLevel);
    }
    await saveThinkingPreference();
    await rememberModel(preferences, templateForChat(context.chat, context.project)?.id, targetModel,
      thinkingLevel || context.chat.modelThinkingLevels?.[targetModel] || "");
    response.json(await chatModelView(context));
    });
  });

  app.delete("/v0/chats/:chatId", async (request, response) => {
    if (request.query.ifEmpty !== "true") return response.status(409).json({ error: "use_chat_delete_route" });
    if (!isChatId(request.params.chatId)) return response.status(404).json({ error: "chat_not_found" });
    const removed = await lifecycle.deleteChat(request.params.chatId, async () => {
      const context = await findChatContext(request.params.chatId);
      if (!context) return null;
      return lifecycle.withProjects([context.project.id], async () => {
        // Only a draft is stopped: a chat that has begun (its first reply streaming) keeps its agent; 409 below.
        if (registry.metadata(context.chat.id)?.status !== "draft") return false;
        await stopSessionProcesses(backends, context.chat);
        return registry.removeEmptyDraft(context.chat.id, context.project);
      });
    });
    if (removed == null) return response.status(404).json({ error: "chat_not_found" });
    response.status(removed ? 204 : 409).end();
  });
}
