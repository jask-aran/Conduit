import { resolveTemplate } from "../../config.js";
import { chatView, isChatId } from "../../chat-store.js";
import { stopSessionProcesses } from "../../session-operations.js";
import { resolveModelProfile } from "../../model-profiles.js";
import { usesWebSearchOverlay } from "../../model-profile-runtime.js";

export function registerChatRoutes(app, {
  catalogFor,
  chatModelView,
  config,
  defaultTemplate,
  findChatContext,
  launchLiveSession,
  lifecycle,
  manager,
  modelCatalog,
  projects,
  registry,
  runtimeFor,
  templateForChat,
}) {
  app.get("/v0/models", async (request, response, next) => {
    try {
      const project = await projects.get(request.query.projectId || "chat");
      if (!project) return response.status(404).json({ error: "project_not_found" });
      response.json({ installationId: "conduit-pinned", runtimeKind: "conduit_profile", ...await modelCatalog.list(project.path) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v0/settings", async (request, response, next) => {
    try {
      const project = await projects.get(request.query.projectId || "chat");
      if (!project) return response.status(404).json({ error: "project_not_found" });
      response.json({ installationId: "conduit-pinned", runtimeKind: "conduit_profile", ...await modelCatalog.getSettings(project.path) });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/v0/settings", async (request, response, next) => {
    try {
      const project = await projects.get(request.body?.projectId || "chat");
      if (!project) return response.status(404).json({ error: "project_not_found" });
      await projects.validate(project);
      response.json({ installationId: "conduit-pinned", runtimeKind: "conduit_profile", ...await modelCatalog.updateSettings(project.path, request.body) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v0/chats", async (request, response, next) => {
    try {
      const project = await projects.get(request.body?.projectId || "chat");
      if (!project) return response.status(404).json({ error: "project_not_found" });
      await lifecycle.withProjects([project.id], async () => {
        await projects.validate(project);
        const hostDefault = project.defaultTemplateId === "host-pi" && request.body?.templateId == null && request.body?.runtimeKind == null;
        const hostAvailable = config.installations.get("host-pi").available;
        if (hostDefault && !hostAvailable) {
          await projects.update(project.id, { defaultTemplateId: null });
          project.defaultTemplateId = null;
        }
        const requestedTemplateId = request.body?.templateId || (project.defaultTemplateId === "host-pi" ? null : project.defaultTemplateId) || null;
        const template = requestedTemplateId
          ? resolveTemplate(config, requestedTemplateId)
          : defaultTemplate();
        if (!template) return response.status(400).json({ error: "unknown_template", templateId: requestedTemplateId });
        if (template.defaultable === false) return response.status(400).json({ error: "special_template", templateId: template.id });
        const runtimeKind = request.body?.runtimeKind || (hostDefault && hostAvailable ? "native_pi" : "conduit_profile");
        if (!new Set(["conduit_profile", "native_pi"]).has(runtimeKind)) {
          return response.status(400).json({ error: "unknown_runtime_kind" });
        }
        if (runtimeKind === "native_pi" && project.kind !== "workspace") {
          return response.status(400).json({ error: "native_pi_requires_workspace" });
        }
        const runtime = runtimeFor({ runtimeKind, template });
        if (runtimeKind === "native_pi" && !config.installations.get("host-pi").available) {
          return response.status(409).json({ error: "native_pi_unavailable" });
        }
        const chat = await registry.create(project, {
          templateId: template.id,
          templateVersion: template.version,
          runtime,
        });
        response.status(201).json(chatView(chat));
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

  app.patch("/v0/chats/:chatId", async (request, response, next) => {
    try {
      const context = await findChatContext(request.params.chatId);
      if (!context) return response.status(404).json({ error: "chat_not_found" });
      if (lifecycle.isBusy(context.chat.id) && (request.body?.templateId != null || request.body?.runtimeKind != null)) {
        return response.status(409).json({ error: "runtime_locked", message: "Pi is already starting for this chat." });
      }
      let selectedTemplate = templateForChat(context.chat, context.project);
      if (request.body?.templateId != null) {
        const currentTemplate = resolveTemplate(config, context.chat.templateId);
        if (currentTemplate?.special === true) {
          return response.status(409).json({ error: "special_chat_locked" });
        }
        if (context.chat.status !== "draft" || context.chat.piSessionFile) {
          return response.status(409).json({ error: "template_locked" });
        }
        const template = resolveTemplate(config, request.body.templateId);
        if (!template) {
          return response.status(400).json({ error: "unknown_template", templateId: request.body.templateId });
        }
        if (template.defaultable === false) {
          return response.status(400).json({ error: "special_template", templateId: template.id });
        }
        await registry.update(context.chat.id, {
          templateId: template.id,
          templateVersion: template.version,
        });
        selectedTemplate = template;
      }
      if (request.body?.runtimeKind != null) {
        if (context.project.kind !== "workspace") {
          return response.status(400).json({ error: "native_pi_requires_workspace" });
        }
        if (context.chat.status !== "draft" || context.chat.piSessionFile) {
          return response.status(409).json({ error: "runtime_locked" });
        }
        const runtimeKind = request.body.runtimeKind;
        if (!new Set(["conduit_profile", "native_pi"]).has(runtimeKind)) {
          return response.status(400).json({ error: "unknown_runtime_kind" });
        }
        const runtime = runtimeFor({ runtimeKind, template: selectedTemplate });
        if (runtimeKind === "native_pi" && !config.installations.get("host-pi").available) {
          return response.status(409).json({ error: "native_pi_unavailable" });
        }
        await registry.update(context.chat.id, { runtime });
      }
      response.json(chatView(registry.metadata(context.chat.id)));
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
      const context = await findChatContext(request.params.chatId);
      if (!context) return response.status(404).json({ error: "chat_not_found" });
      const spec = String(request.body?.model || "").trim();
      const thinkingLevel = String(request.body?.thinkingLevel || "").trim();
      const current = await chatModelView(context);
      if (spec && !current.models.some((item) => item.spec === spec)) {
        return response.status(400).json({ error: "invalid_model" });
      }
      const targetModel = spec || current.model;
      const target = current.models.find((item) => item.spec === targetModel);
      if (thinkingLevel && target && !target.thinkingLevels.includes(thinkingLevel)) {
        return response.status(400).json({ error: "invalid_thinking_level" });
      }
      const saveThinkingPreference = async () => {
        if (!targetModel || !thinkingLevel) return context.chat;
        return registry.update(context.chat.id, {
          modelThinkingLevels: { ...(context.chat.modelThinkingLevels || {}), [targetModel]: thinkingLevel },
        });
      };
      const resident = manager.getByChatId(context.chat.id);
      if (resident) {
        if (spec && spec !== current.model) {
          const template = templateForChat(context.chat, context.project);
          const runtime = context.chat.runtime || runtimeFor({ runtimeKind: "conduit_profile", template });
          const profileForModel = (model) => runtime.kind === "conduit_profile" && usesWebSearchOverlay(template)
            ? resolveModelProfile(config.modelProfiles, model || "unknown/unresolved")
            : null;
          const currentProfile = resident.modelProfile || profileForModel(current.model);
          const targetProfile = profileForModel(spec);
          if (currentProfile?.id !== targetProfile?.id) {
            if (manager.isBusy(resident)) {
              return response.status(409).json({
                error: "model_profile_transition_busy",
                message: "Finish the current response before changing to a model with different runtime settings.",
              });
            }
            await manager.setModel(resident.id, spec);
            await manager.stopAndWait(resident.id);
            await launchLiveSession({
              chatId: context.chat.id,
              model: spec,
              thinkingLevel,
              forceModel: true,
            });
          } else {
            await manager.setModel(resident.id, spec);
          }
        }
        const activeResident = manager.getByChatId(context.chat.id);
        if (thinkingLevel && activeResident) await manager.setThinkingLevel(activeResident.id, thinkingLevel);
      } else {
        if (context.chat.status !== "draft" || context.chat.piSessionFile) {
          return response.status(409).json({ error: "live_session_required" });
        }
        const template = templateForChat(context.chat, context.project);
        const runtime = context.chat.runtime || runtimeFor({ runtimeKind: "conduit_profile", template });
        if (runtime.kind === "native_pi") {
          const chat = await saveThinkingPreference();
          return response.json({
            ...current,
            model: spec || current.model,
            thinkingLevel: thinkingLevel || current.thinkingLevel,
            modelThinkingLevels: chat?.modelThinkingLevels || {},
          });
        }
        if (spec) await catalogFor(runtime, template).updateDefault(context.project.path, spec, thinkingLevel);
      }
      await saveThinkingPreference();
      response.json(await chatModelView(context));
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
          await stopSessionProcesses(manager, context.chat);
          return registry.removeEmptyDraft(context.chat.id, context.project);
        });
      });
      if (removed == null) return response.status(404).json({ error: "chat_not_found" });
      response.status(removed ? 204 : 409).end();
    } catch (error) { next(error); }
  });
}
