import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { isChatId } from "../chat-store.js";
import { readSessionMetadata, validateSessionHeader } from "../session-store.js";
import { resolvePiLaunch } from "../pi-launch.js";
import { resolveThinkingLevel } from "../pi-model-catalog.js";
import { publicModelProfile, resolveModelProfile } from "../model-profiles.js";
import { usesWebSearchOverlay } from "../model-profile-runtime.js";

function launchError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function createLiveSessionLauncher({
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
}) {
  async function launchFromContext(context, {
    requestedProject = "",
    model = "",
    thinkingLevel = "",
    forceModel = false,
  } = {}) {
    lifecycle.assertAvailable(context.chat.id, context.project.id);
    if (requestedProject && ![context.project.id, context.project.slug].includes(requestedProject)) {
      throw launchError("session_project_mismatch", "The requested project does not own this chat", 409);
    }
    const resident = manager.getByChatId(context.chat.id);
    if (resident) return { live: resident, modelRecovery: null };

    const template = templateForChat(context.chat, context.project);
    const runtime = context.chat.runtime || runtimeFor({ runtimeKind: "conduit_profile", template });
    const installation = config.installations.get(runtime.installationId);
    if (!installation) throw launchError("runtime_unavailable", `Runtime installation is unavailable: ${runtime.installationId}`, 409);

    let persisted = null;
    if (context.chat.piSessionFile) {
      try {
        await validateSessionHeader(context.chat.piSessionFile, context.project);
        persisted = await readSessionMetadata(context.chat.piSessionFile, context.project);
      } catch (error) {
        if (error.code === "ENOENT") context.chat.piSessionFile = null;
        else throw launchError("session_file_unavailable", error.message, 409);
      }
    }

    if (runtime.kind === "native_pi") {
      const preflight = await nativePreflight(context.project);
      if (!preflight.available) throw launchError("native_pi_unavailable", preflight.error, 409);
      new ProjectTrustStore(installation.agentDir).set(context.project.workingRoot, true);
    }

    const runtimeCatalog = catalogFor(runtime, template);
    const catalogView = await runtimeCatalog.list(context.project.workingRoot);
    const requestedModel = text(model);
    const requestedThinkingLevel = text(thinkingLevel);
    const persistedModel = context.chat.piSessionFile ? text(persisted?.model) : "";
    const persistedOutsideScope = runtime.kind === "conduit_profile"
      && Boolean(persistedModel)
      && !catalogView.models.some((item) => item.spec === persistedModel);
    const fallbackModel = catalogView.defaultModel || catalogView.models[0]?.spec || "";
    if (persistedOutsideScope && !fallbackModel) {
      throw launchError("no_scoped_model", "The previous model is no longer scoped and no scoped model is available", 409);
    }
    const seedModel = forceModel
      ? requestedModel
      : persistedOutsideScope
        ? fallbackModel
        : context.chat.piSessionFile
          ? persistedModel
        : requestedModel;
    const seedThinkingLevel = forceModel
      ? requestedThinkingLevel
      : context.chat.piSessionFile
        ? text(persisted?.thinkingLevel)
        : requestedThinkingLevel;
    if (seedModel && !catalogView.models.some((item) => item.spec === seedModel)) {
      throw launchError("invalid_model", "The selected model is not available in this Pi profile");
    }
    const selected = catalogView.models.find((item) => item.spec === seedModel);
    const recoveringPersistedLevel = Boolean(persisted && !forceModel);
    if (seedThinkingLevel && seedModel) {
      if (selected && !selected.thinkingLevels.includes(seedThinkingLevel) && !recoveringPersistedLevel) {
        throw launchError("invalid_thinking_level", "The selected thinking level is not available for this model");
      }
    }

    const effectiveThinkingLevel = selected && recoveringPersistedLevel
      ? resolveThinkingLevel(seedThinkingLevel, selected.thinkingLevels, catalogView.defaultThinkingLevel)
      : seedThinkingLevel;

    const processModel = runtime.kind === "conduit_profile" ? seedModel || catalogView.defaultModel || "" : seedModel;
    const processThinkingLevel = runtime.kind === "conduit_profile"
      ? effectiveThinkingLevel || catalogView.defaultThinkingLevel || ""
      : effectiveThinkingLevel;
    const repairedThinkingLevel = recoveringPersistedLevel
      && Boolean(processModel)
      && Boolean(effectiveThinkingLevel)
      && effectiveThinkingLevel !== seedThinkingLevel;
    let modelProfile = null;
    let runtimeAgentDir = installation.agentDir;
    if (runtime.kind === "conduit_profile" && usesWebSearchOverlay(template)) {
      const profileModel = processModel || "unknown/unresolved";
      modelProfile = resolveModelProfile(config.modelProfiles, profileModel);
      const materialized = await modelProfileRuntime.materialize({ template, profile: modelProfile });
      runtimeAgentDir = materialized.agentDir;
    }

    const launchSpec = resolvePiLaunch({
      chat: context.chat,
      project: context.project,
      installation,
      template: runtime.kind === "conduit_profile" ? template : null,
      models: runtime.kind === "conduit_profile" ? runtimeCatalog.getLaunchModels(context.project.workingRoot) : null,
      model: processModel,
      thinkingLevel: processThinkingLevel,
      bridgeSystemPrompt: config.bridgeSystemPrompt,
      bridgeSkill: config.bridgeSkill,
      runtimeAgentDir,
      modelProfile: publicModelProfile(modelProfile),
    });
    console.info("Launching Pi", {
      chatId: context.chat.id,
      projectId: context.project.id,
      runtimeKind: runtime.kind,
      installationId: installation.id,
      binaryVersion: installation.version,
      profileId: runtime.profileId,
      profileVersion: runtime.profileVersion,
      modelProfileId: modelProfile?.id || null,
      cwd: launchSpec.cwd,
      sessionFile: launchSpec.sessionFile,
      trustPosture: launchSpec.trustPosture,
    });

    lifecycle.assertAvailable(context.chat.id, context.project.id);
    let live = null;
    try {
      live = await manager.createWithCapacity({
        project: context.project,
        chatId: context.chat.id,
        sessionFile: context.chat.piSessionFile,
        model: processModel,
        thinkingLevel: processThinkingLevel,
        template: runtime.kind === "conduit_profile" ? template : null,
        launchSpec,
      });
      await manager.waitForSession(live.id);
      lifecycle.assertAvailable(context.chat.id, context.project.id);
      if (persistedOutsideScope) await manager.setModel(live.id, processModel);
      if (runtime.kind === "native_pi" && seedModel) {
        await manager.setModel(live.id, seedModel);
        if (effectiveThinkingLevel) await manager.setThinkingLevel(live.id, effectiveThinkingLevel);
      }
      if (!live.sessionFile) throw launchError("invalid_session_mapping", "Pi did not report a session file", 409);
      const mapping = {
        templateId: template.id,
        templateVersion: template.version,
        runtime: { ...runtime },
        ...(repairedThinkingLevel ? {
          modelThinkingLevels: {
            ...(context.chat.modelThinkingLevels || {}),
            [processModel]: processThinkingLevel,
          },
        } : {}),
      };
      if (context.chat.status === "draft") {
        mapping.piSessionId = live.sessionId || null;
        mapping.piSessionFile = live.sessionFile;
      }
      await registry.update(context.chat.id, mapping);
      return {
        live,
        modelRecovery: persistedOutsideScope ? {
          from: persistedModel,
          to: processModel,
          reason: "outside_scope",
        } : null,
      };
    } catch (error) {
      if (live && ["starting", "running"].includes(live.status)) await manager.stopAndWait(live.id).catch(() => {});
      throw error;
    }
  }

  return async function launchLiveSession({
    chatId,
    requestedProject = "",
    model = "",
    thinkingLevel = "",
    forceModel = false,
  } = {}) {
    if (!isChatId(chatId)) throw launchError("chat_not_found", "Chat not found", 404);
    return lifecycle.runLaunch(chatId, async () => {
      const context = await findChatContext(chatId);
      if (!context) throw launchError("chat_not_found", "Chat not found", 404);
      return lifecycle.withProjects([context.project.id], async () => launchFromContext(context, {
        requestedProject,
        model,
        thinkingLevel,
        forceModel,
      }));
    });
  };
}
