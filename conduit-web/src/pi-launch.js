import path from "node:path";
import { projectEnvironment } from "./project-environment.js";
import {
  buildPiEnvironment,
  buildPiResourceArgs,
  resolvePiProcess,
} from "../../scripts/pi-runtime.mjs";
import { readSessionMetadata, validateSessionHeader } from "./session-store.js";
import { resolveThinkingLevel } from "./pi-model-catalog.js";
import { resolveModelProfile } from "./model-profiles.js";
import { usesWebSearchOverlay } from "./model-profile-runtime.js";
import { conduitPiSessionFile } from "./backend-session.js";

const SENSITIVE_ENV = /^(?:CONDUIT_|COOKIE|SESSION|BROKER|EDGE_AUTH|AUTH_TOKEN|GITHUB_TOKEN|GH_TOKEN$)/i;

function filteredEnvironment(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !SENSITIVE_ENV.test(key)));
}

function sessionArgs(sessionFile, model, thinkingLevel) {
  const args = [];
  if (sessionFile) args.push("--session", path.resolve(sessionFile));
  if (model?.trim()) args.push("--model", model.trim());
  if (thinkingLevel?.trim()) args.push("--thinking", thinkingLevel.trim());
  return args;
}

export function resolvePiLaunch({
  chat,
  project,
  installation,
  template,
  models,
  model = "",
  thinkingLevel = "",
  bridgeSystemPrompt,
  bridgeSkill,
  runtimeAgentDir = "",
  modelProfile = null,
  systemPrompt = null,
}) {
  if (!installation?.available || !installation.command) {
    const error = new Error(installation?.error || "Pi installation is unavailable");
    error.code = "runtime_version_unavailable";
    throw error;
  }
  const cwd = path.resolve(project.workingRoot);
  const sessionFile = conduitPiSessionFile(chat);
  const runtime = chat.runtime;
  const processSpec = resolvePiProcess(installation.command, installation.commandArgs || []);
  if (!template) {
    const error = new Error(`Profile ${runtime.profileId || "unknown"} is unavailable`);
    error.code = "profile_version_unavailable";
    throw error;
  }
  return {
    command: processSpec.command,
    args: [
      ...processSpec.args,
      "--mode", "rpc",
      ...buildPiResourceArgs({ ...template, ...(models ? { models } : {}), ...(systemPrompt ? { systemPrompt } : {}) }),
      ...sessionArgs(sessionFile, model, thinkingLevel),
    ],
    cwd,
    env: projectEnvironment(project, cwd, {
      ...buildPiEnvironment(runtimeAgentDir || installation.agentDir, filteredEnvironment(installation.environment || process.env)),
      PI_CODING_AGENT_SESSION_DIR: project.sessionsDir,
    }),
    sessionFile: sessionFile ? path.resolve(sessionFile) : null,
    runtime,
    binaryVersion: installation.version,
    trustPosture: "ignore_project_resources",
    modelProfile,
  };
}

const cleanText = (value) => typeof value === "string" ? value.trim() : "";
const launchError = (code, message, status = 400) => Object.assign(new Error(message), { code, status });

export async function launchConduitPi(adapter, context, request, services) {
  const { catalogFor, config, lifecycle, modelProfileRuntime, runtimeFor, templateForChat } = services;
  const { model = "", thinkingLevel = "", forceModel = false } = request;
  const template = templateForChat(context.chat, context.project);
  const runtime = context.chat.runtime || runtimeFor({ runtimeKind: "conduit_profile", template });
  const installation = config.installations.get(runtime.installationId);
  if (!installation) throw launchError("runtime_unavailable", `Runtime installation is unavailable: ${runtime.installationId}`, 409);

  let sessionFile = conduitPiSessionFile(context.chat);
  let persisted = null;
  if (sessionFile) {
    try {
      await validateSessionHeader(sessionFile, context.project);
      persisted = await readSessionMetadata(sessionFile, context.project);
    } catch (error) {
      if (error.code === "ENOENT") sessionFile = null;
      else throw launchError("session_file_unavailable", error.message, 409);
    }
  }

  const runtimeCatalog = catalogFor(runtime, template);
  const catalogView = await runtimeCatalog.list(context.project.workingRoot);
  const requestedModel = cleanText(model);
  const requestedThinkingLevel = cleanText(thinkingLevel);
  const persistedModel = sessionFile ? cleanText(persisted?.model) : "";
  const persistedOutsideScope = Boolean(persistedModel)
    && !catalogView.models.some((item) => item.spec === persistedModel);
  const fallbackModel = catalogView.defaultModel || catalogView.models[0]?.spec || "";
  if (persistedOutsideScope && !fallbackModel) {
    throw launchError("no_scoped_model", "The previous model is no longer scoped and no scoped model is available", 409);
  }
  const seedModel = forceModel ? requestedModel
    : persistedOutsideScope ? fallbackModel
    : sessionFile ? persistedModel : requestedModel;
  const seedThinkingLevel = forceModel ? requestedThinkingLevel
    : sessionFile ? cleanText(persisted?.thinkingLevel) : requestedThinkingLevel;
  if (seedModel && !catalogView.models.some((item) => item.spec === seedModel)) {
    throw launchError("invalid_model", "The selected model is not available in this Pi profile");
  }
  const selected = catalogView.models.find((item) => item.spec === seedModel);
  const recoveringPersistedLevel = Boolean(persisted && !forceModel);
  if (seedThinkingLevel && seedModel && selected
    && !selected.thinkingLevels.includes(seedThinkingLevel) && !recoveringPersistedLevel) {
    throw launchError("invalid_thinking_level", "The selected thinking level is not available for this model");
  }
  const effectiveThinkingLevel = selected && recoveringPersistedLevel
    ? resolveThinkingLevel(seedThinkingLevel, selected.thinkingLevels, catalogView.defaultThinkingLevel)
    : seedThinkingLevel;
  const processModel = seedModel || catalogView.defaultModel || "";
  const processThinkingLevel = effectiveThinkingLevel || catalogView.defaultThinkingLevel || "";
  const repairedThinkingLevel = recoveringPersistedLevel && Boolean(processModel)
    && Boolean(effectiveThinkingLevel) && effectiveThinkingLevel !== seedThinkingLevel;
  const modelProfile = usesWebSearchOverlay(template)
    ? processModel
      ? resolveModelProfile(config.modelProfiles, processModel)
      : config.modelProfiles.profiles.find((profile) => profile.matches.some((match) => match.kind === "catch_all"))
    : null;
  const materialized = await modelProfileRuntime.materialize({ template, profile: modelProfile });
  const launchSpec = resolvePiLaunch({
    chat: context.chat, project: context.project, installation, template,
    models: runtimeCatalog.getLaunchModels(context.project.workingRoot),
    model: processModel, thinkingLevel: processThinkingLevel,
    bridgeSystemPrompt: config.bridgeSystemPrompt, bridgeSkill: config.bridgeSkill,
    runtimeAgentDir: materialized.agentDir, modelProfile: materialized.modelProfile,
    systemPrompt: config.promptStore ? await config.promptStore.pathFor(template.id) : null,
  });
  lifecycle.assertAvailable(context.chat.id, context.project.id);
  let live = null;
  try {
    const options = { project: context.project, chatId: context.chat.id,
      sessionFile, model: processModel,
      thinkingLevel: processThinkingLevel, template, launchSpec };
    live = sessionFile
      ? await adapter.restore(sessionFile, options)
      : await adapter.create(options);
    await adapter.waitForSession(live.id);
    lifecycle.assertAvailable(context.chat.id, context.project.id);
    if (persistedOutsideScope) await adapter.setModel(live.id, processModel);
    if (!live.sessionFile) throw launchError("invalid_session_mapping", "Pi did not report a session file", 409);
    return {
      live,
      mapping: {
        templateId: template.id, templateVersion: template.version, runtime: { ...runtime },
        ...(repairedThinkingLevel ? { modelThinkingLevels: {
          ...(context.chat.modelThinkingLevels || {}), [processModel]: processThinkingLevel,
        } } : {}),
        ...(context.chat.status === "draft" ? {
          backend: { ...context.chat.backend, opaqueSession: live.sessionFile },
        } : {}),
      },
      modelRecovery: persistedOutsideScope
        ? { from: persistedModel, to: processModel, reason: "outside_scope" } : null,
    };
  } catch (error) {
    if (live && ["starting", "running"].includes(live.status)) await adapter.close(live.id).catch(() => {});
    throw error;
  }
}
