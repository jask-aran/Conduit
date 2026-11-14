import { writePerson } from "./agent/routine-files.js";
import { registerAccountRoutes } from "./server/routes/account.js";
import { capabilitiesOf, hubIds } from "./place.js";
import { projectWorkspace } from "./workspace-host.js";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import express from "express";
import compression from "compression";
import { WebSocketServer } from "ws";
import { loadConfig, resolveTemplate } from "./config.js";
import { holdPrivately } from "./private-file.js";
import { TerminalPasteStore } from "./terminal-paste-store.js";
import { PiModelCatalog, resolveThinkingLevel } from "./pi-model-catalog.js";
import { scriptedProvider } from "./server/scripted-model.js";
import { ProjectStore } from "./project-store.js";
import { ChatLogs } from "./server/chat-log.js";
import { TurnTimings } from "./server/turn-timings.js";
import { manifestForImplementation } from "./harnesses/index.js";
import { ChatStore, chatView, isChatId } from "./chat-store.js";
import { resolveComputerContext } from "./computer-context.js";
import { AttachmentStore } from "./attachment-store.js";
import { RuntimeHub } from "./runtime-hub.js";
import { defaultsFromEnv, RuntimeSettingsStore } from "./runtime-settings.js";
import { localPaths, ServerIdentity } from "./server-identity.js";
import { attestLeaf, ServerLeaf } from "./server-tls.js";
import { LanAdvertisement } from "./lan-advertisement.js";
import { DraftStore } from "./draft-store.js";
import { PreferencesStore } from "./preferences-store.js";
import { SessionNameService } from "./session-name-service.js";
import { templatePublicView } from "../../scripts/pi-runtime.mjs";
import { formatWorkspacePath, isPathInside, listDirectorySuggestions } from "./workspace-paths.js";
import fs from "node:fs/promises";
import { AuthStore } from "./auth-store.js";
import { PiAuthBroker } from "./pi-auth-broker.js";
import { ChatLifecycle } from "./chat-lifecycle.js";
import {
  authStartupViolation,
  isSecureRequest as secureRequest,
  nativeCors,
  prepareAuthMiddleware,
  validateSession,
} from "./auth-middleware.js";
import { SocketTicketStore, installedClientOrigin } from "./native-auth.js";
import { listWorkspaceDirectory, onWorkspaceChange, readWorkspaceCommit, readWorkspaceDiff, readWorkspaceFile, readWorkspaceFileMetadata, readWorkspaceVersion, runWorkspaceGitAction } from "./workspace-inspector.js";
import { currentMagicDnsOrigin } from "./tailscale-share.js";
import { buildProjectDashboard } from "./project-dashboard.js";
import { PtyManager } from "./pty-manager.js";
import { createLiveSessionStream } from "./server/live-session-stream.js";
import { UiControl } from "./server/ui-control.js";
import { createMcpEndpoint, mcpToken } from "./server/mcp-endpoint.js";
import { mcpAccess } from "./server/mcp-access.js";
import { BrowserHost, createBrowsers } from "./server/browser-host.js";
import { PersonBrowser } from "./nodes/person-browser.js";
import { createPersonBrowsers } from "./server/person-browsers.js";
import { registerPersonBrowserRoutes } from "./server/routes/person-browsers.js";
import { tunnelTo } from "./nodes/remote-tunnel.js";
import { registerBrowserRoutes } from "./server/routes/browsers.js";
import { createScreens } from "./server/screens.js";
import { createBrowserProxy } from "./server/browser-proxy.js";
import { registerSkillRoutes } from "./server/routes/skills.js";
import { SkillStore } from "./skills/skill-store.js";
import { createTerminalStream } from "./server/terminal-stream.js";
import { createDictationStream } from "./server/dictation-stream.js";
import { VoiceRuntime } from "./server/voice-runtime.js";
import { VoiceModelManager } from "./server/voice-model-manager.js";
import { VoiceRecordingStore, VOICE_ARCHIVE_SHUTDOWN_TIMEOUT_MS } from "./server/voice-recording-store.js";
import { VoiceHistory } from "./server/voice-history.js";
import { registerAttachmentRoutes } from "./server/routes/attachments.js";
import { registerAuthRoutes } from "./server/routes/auth.js";
import { registerPiAuthRoutes } from "./server/routes/pi-auth.js";
import { registerPtyRoutes } from "./server/routes/ptys.js";
import { registerTerminalPasteRoutes } from "./server/routes/terminal-paste.js";
import { registerDraftRoutes } from "./server/routes/drafts.js";
import { registerRuntimeRoutes } from "./server/routes/runtime.js";
import { registerChatRoutes } from "./server/routes/chats.js";
import { registerRunRoutes } from "./server/routes/runs.js";
import { registerAgentRoutes } from "./server/routes/agent.js";
import { onWorkChanged, WorkLog } from "./agent/work-log.js";
import { registerDiagnosticsRoutes } from "./server/routes/diagnostics.js";
import { PersistentAgent } from "./agent/agent.js";
import { createChatHost } from "./agent/chat-host.js";
import { startEvents } from "./agent/events.js";
import { seedSchedules } from "./agent/schedule.js";
import { armReminders } from "./agent/asks.js";
import { agentNotifier } from "./agent/notify.js";
import { MessageLog, mirrorHomeThread } from "./agent/messages.js";
import { EmailChannel } from "./agent/email.js";
import { PushService } from "./push/push-service.js";
import { registerPushRoutes } from "./server/routes/push.js";
import { createHostUi } from "./server/host-ui.js";
import { registerHarnessRoutes } from "./server/routes/harnesses.js";
import { createHarnessModelCatalogue } from "./harnesses/model-catalogue.js";
import { rememberedModel } from "./profile-model-memory.js";
import { registerLiveSessionRoutes } from "./server/routes/live-sessions.js";
import { registerProjectRoutes } from "./server/routes/projects.js";
import { hubRoutes, registerNodeRoutes } from "./server/routes/nodes.js";
import { NodeHub } from "./nodes/node-hub.js";
import { lanNames } from "./nodes/lan-names.js";
import { directAddresses } from "./nodes/direct.js";
import { lanNamesService } from "./network/lan-names-service.js";
import { registerNetworkRoutes } from "./server/routes/network.js";
import { registerSessionRoutes } from "./server/routes/sessions.js";
import { registerSessionContextRoutes } from "./server/routes/session-context.js";
import { registerSearchRoutes } from "./server/routes/search.js";
import { registerVoiceRoutes } from "./server/routes/voice.js";
import { SearchSettingsStore } from "./search-settings.js";
import { VoiceSettingsStore } from "./voice-settings.js";
import { VOICE_EXECUTION_CATALOG } from "./server/voice-execution-catalog.js";
import { ContextStore } from "./context/context-store.js";
import { registerContextRoutes } from "./server/routes/context.js";
import { registerClientReportRoutes } from "./server/routes/client-reports.js";
import { createFeedback, registerMarkupRoutes } from "./server/feedback.js";
import { createDocuments, registerDocumentRoutes } from "./server/documents.js";
import { ChatBackendRegistry, isGeneratingRecord } from "./chat-backend-registry.js";
import { MANIFESTS } from "./harnesses/index.js";
import { detect } from "./harnesses/probe.js";
import { TurnCheckpointStore } from "./turn-checkpoint-store.js";
import { ServerConcurrency } from "./server/effect-concurrency.js";
import { ServerLifetime } from "./server/server-lifetime.js";
import { createClientBundle } from "./server/client-bundle.js";

const config = loadConfig();
await holdPrivately(config.dataRoot);
const turnCheckpoints = new TurnCheckpointStore(path.join(config.dataRoot, "turn-checkpoints"));
void turnCheckpoints.sweep().catch((error) => console.warn("Could not clear old turn checkpoints", error.message));
const projects = new ProjectStore(config);
await projects.initialize();
// What is handed to this as it is made is let go in reverse when the server stops.
const lifetime = new ServerLifetime();
const terminals = lifetime.own("terminals", new PtyManager({ filePath: config.remotesFile, terminalTeardown: config.terminalTeardown }), async (owned) => {
  const stopped = await owned.stopAll();
  console.log(`Conduit ${config.terminalTeardown ? "stopped" : "preserved"} ${stopped} terminal session${stopped === 1 ? "" : "s"}`);
});
await terminals.load();
// Bound to loopback, the server is reached only through this machine (directly, or by Tailscale, a tunnel or SSH
// landing here), so it neither publishes its network addresses nor advertises on one.
const reachableOnNetwork = !/^(127\.\d+\.\d+\.\d+|localhost|::1|\[::1\])$/.test(config.host);
const serverIdentity = lifetime.own("server identity", await new ServerIdentity(config.identityFile, { port: config.port, network: reachableOnNetwork }).load(), (owned) => owned.flush());
serverIdentity.followObserved();
// Known before anything reads a project.
const hub = hubIds(serverIdentity.id);
projects.hubNodeId = hub.nodeId;
const registry = new ChatStore(config.sessionRegistryFile);
await registry.initialize(await projects.list());
const attachments = new AttachmentStore(registry, { maxBytes: config.maxAttachmentBytes });
const terminalPastes = new TerminalPasteStore({ root: config.terminalPasteRoot });
const runtimeSettings = new RuntimeSettingsStore(config.runtimeSettingsFile, defaultsFromEnv(process.env));
await runtimeSettings.load();
const leafStore = new ServerLeaf(config.leafFile);
const leafFor = () => ({
  commonName: `Conduit ${serverIdentity.id}`,
  hosts: localPaths(config.port).map((origin) => new URL(origin).hostname),
  identityId: serverIdentity.id,
  attest: (spki) => attestLeaf(serverIdentity.id, spki, serverIdentity.privateKey),
});
let serverLeaf = await leafStore.ensure(leafFor());
const lanAdvertisement = lifetime.own("LAN advertisement", new LanAdvertisement({
  identity: serverIdentity,
  enabled: config.advertiseOnLan && reachableOnNetwork,
  log: (event) => console.log(JSON.stringify(event)),
}), (owned) => owned.stop());
const searchSettings = new SearchSettingsStore({ filePath: config.searchConfigFile, environment: process.env });
await searchSettings.initialize();
const voiceSettings = new VoiceSettingsStore({ filePath: config.voiceConfigFile, catalog: VOICE_EXECUTION_CATALOG });
await voiceSettings.initialize();
const voiceModel = lifetime.own("voice model", new VoiceModelManager({ root: config.voiceModelRoot, catalog: VOICE_EXECUTION_CATALOG }), (owned) => owned.stop());
const voiceRecordingStore = lifetime.own("voice archive", new VoiceRecordingStore({ root: config.voiceRecordingsRoot }), async (owned) => {
  const result = await owned.drain({ timeoutMs: VOICE_ARCHIVE_SHUTDOWN_TIMEOUT_MS });
  console.log(JSON.stringify({ type: "conduit.voice-archive-drain", ...result }));
}, { timeoutMs: VOICE_ARCHIVE_SHUTDOWN_TIMEOUT_MS + 1_000 });
const voiceRuntime = new VoiceRuntime({ settings: voiceSettings, modelManager: voiceModel, catalog: VOICE_EXECUTION_CATALOG });
const skills = await new SkillStore({ root: path.join(config.dataRoot, "skills"), templates: config.piTemplates }).load();
const contextStore = new ContextStore({
  skills,
  root: config.promptOverridesRoot, templates: config.piTemplates,
  agent: () => backends.adapters.get("conduit-runtime")?.runtime.agent,
  webPath: path.join(config.repositoryRoot, "templates/web-tools/WEB.md"),
  seedDir: path.join(config.repositoryRoot, "templates/agent/seed"),
  subagentPath: path.join(config.repositoryRoot, "templates/subagent/BRIEF.md"),
  chatNamingPath: config.sessionNamePrompt,
});
config.contextStore = contextStore;
const knownTemplateIds = config.piTemplates
  .filter((template) => template.defaultable !== false)
  .map((template) => template.id);
const preferences = new PreferencesStore(
  config.preferencesFile,
  { defaultTemplateId: config.piTemplate.id },
  { knownTemplateIds },
);
const drafts = new DraftStore(config.draftsFile);
await Promise.all([preferences.load(), drafts.load()]);
const authStore = new AuthStore(config.authFile);
await authStore.load();
await authStore.pruneExpired();
const socketTickets = new SocketTicketStore();
const startupViolation = authStartupViolation(config, authStore);
if (startupViolation) {
  console.error(startupViolation.message);
  process.exit(1);
}
// One order per chat, shared by everything that publishes into a chat: the harness process and the command handlers.
const chatLogs = new ChatLogs({ timings: new TurnTimings(path.join(config.dataRoot, "turn-timings")) });
const concurrency = new ServerConcurrency();
// Routes for nodes, never its nodes' names.
const hubLanNames = () => (lanTls?.names || []).filter((name) => !name.startsWith("*."));
serverIdentity.names = hubLanNames;
const networkLanNames = lifetime.own("LAN names", lanNamesService({
  dataRoot: config.dataRoot,
  hubAddress: () => directAddresses(os.networkInterfaces()).find((item) => item.reach === "private")?.address || null,
  onCertificates: async () => {
    await loadLanTls();
    lanNamesForNodes.reload();
    await nodeHub.reofferLanNames();
  },
}), (owned) => owned.stop());
const lanNamesForNodes = lanNames({ provider: () => networkLanNames.provider() });
// With CONDUIT_NODES_PUBLIC=1 devices are taken through the public address too, on their pairing key alone.
const nodeHub = lifetime.own("nodes", new NodeHub({ dataRoot: config.dataRoot, lanNames: lanNamesForNodes,
  identity: { id: serverIdentity.id, key: serverIdentity.publicKeyValue() },
  routes: () => hubRoutes({ config, lanNames: hubLanNames }),
  ...(process.env.CONDUIT_NODES_PUBLIC === "1" ? { allowRemote: () => true } : {}) }), (owned) => owned.shutdown());
terminals.nodeHub = nodeHub;
nodeHub.on("procExit", (event) => terminals.deviceProcessExited(event));
const harnessConfig = {
  logs: chatLogs,
  codexCommand: process.env.CONDUIT_CODEX_COMMAND || "codex",
  claudeCommand: process.env.CONDUIT_CLAUDE_COMMAND || "claude",
  fxCommand: process.env.CONDUIT_FX_COMMAND || "fx",
  opencodeCommand: process.env.CONDUIT_OPENCODE_COMMAND || "opencode2",
  chatgptWebPython: process.env.CONDUIT_CHATGPT_WEB_PYTHON
    || path.join(config.repositoryRoot, "conduit-web/python/.venv/bin/python"),
  chatgptWebScript: process.env.CONDUIT_CHATGPT_WEB_SIDECAR
    || path.join(config.repositoryRoot, "conduit-web/python/chatgpt_web_sidecar.py"),
  chatgptWebDataDir: path.join(config.dataRoot, "chatgpt-web"),
  testStreamDataDir: path.join(config.dataRoot, "test-stream"),
  dataRoot: config.dataRoot,
  piAgentDir: config.piAgentDir,
  nodeHub,
  piTemplates: config.piTemplates,
  contextStore,
};
const backends = lifetime.own("agents", ChatBackendRegistry.fromManifests(MANIFESTS, await detect(MANIFESTS, harnessConfig), harnessConfig), async (owned) => {
  const stopped = await owned.shutdown();
  const count = stopped.get(owned.adapters.get("codex")) || 0;
  console.log(`Conduit stopped ${count} Codex process${count === 1 ? "" : "es"}`);
}, { timeoutMs: 30_000 });
const chatgptWeb = backends.adapters.get("chatgpt-web") || null;
const requireChatgptWeb = () => {
  if (!chatgptWeb) throw Object.assign(new Error("ChatGPT Web is not installed"), { code: "backend_unavailable", status: 409 });
  return chatgptWeb;
};
const runtimeHub = lifetime.own("runtime hub", new RuntimeHub({ listViews: () => backends.list(), listDevices: () => nodeHub.availability() }), (owned) => owned.close());
lifetime.own("keybindings watch", preferences.watchKeybindings((overrides) => runtimeHub.publish({ type: "keybindings_changed", overrides })), (stop) => stop());
{
  let pending = null;
  nodeHub.on("changed", () => { pending ??= setTimeout(() => { pending = null; runtimeHub.publishDevices(); }, 150); });
}
// The snapshot hides records that are stopped or on their way out; so must every incremental update, or a teardown
// emit re-advertises a process the removal already retired.
const processIsLive = (record) => Boolean(record) && !record.terminating && record.status !== "stopped";
// Set once the documents exist (they are made further down): an artifact's row says when its mated thread starts and ends a turn.
let artifactTurned = () => {}, artifactHeard = async () => {};
const publishProcessChange = (view, record, reason) => {
  if (!view) return;
  artifactTurned(view.chatId);
  if (processIsLive(record)) runtimeHub.publishProcess(view, reason || "update");
  else runtimeHub.publishProcessRemoved(view.id, view.chatId);
};
backends.capabilities = (project) => capabilitiesOf(project, { hub: nodeHub, backends, serverName: serverIdentity.name });
nodeHub.adoptHub({ ...hub, name: () => serverIdentity.name,
  roots: async () => (await projects.list()).filter((project) => project.local)
    .map((project) => ({ id: project.place.root, label: project.workingRoot, read: true, write: true, shell: true, allow: [] })),
  harnesses: () => [...(backends.local || backends.adapters.keys())] });

onWorkspaceChange((projectIds) => runtimeHub.publish({ type: "workspace_changed", projectIds }));
terminals.on("created", (record) => runtimeHub.publishTerminal(record, "created"));
terminals.on("updated", (record) => runtimeHub.publishTerminal(record, "updated"));
terminals.on("exit", (record) => runtimeHub.publishTerminal(record, "exit"));
terminals.on("removed", ({ id, projectId }) => runtimeHub.publishTerminalRemoved(id, projectId));
const modelCatalog = new PiModelCatalog({ agentDir: config.piAgentDir, modelPatterns: config.piTemplate.models });
await modelCatalog.ready();
const sessionNames = new SessionNameService({
  file: config.sessionNameLogFile,
  modelCatalog,
  preferences,
  contextStore,
});
const sessionNameTasks = new Map();
const piAuth = new PiAuthBroker({
  modelRuntime: modelCatalog.modelRuntime,
  authFile: modelCatalog.authFile,
});
const modelCatalogs = new Map([[`isolated:${config.piTemplate.id}`, modelCatalog]]);
const lifecycle = new ChatLifecycle({ concurrency });
const app = express();
const dist = process.env.CONDUIT_CLIENT_DIST
  ? path.resolve(process.env.CONDUIT_CLIENT_DIST)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");

function defaultTemplate() {
  const selected = resolveTemplate(config, preferences.get().defaultTemplateId);
  return selected?.defaultable !== false ? selected : config.piTemplate;
}

// Shared with the launch composer so a chat and the dashboard ask the harness once between them.
const harnessModels = createHarnessModelCatalogue();

function catalogFor(runtime, template) {
  const key = `isolated:${template?.id || config.piTemplate.id}`;
  if (!modelCatalogs.has(key)) {
    modelCatalogs.set(key, new PiModelCatalog({ agentDir: config.piAgentDir, modelPatterns: template?.models || config.piTemplate.models,
      ...(template?.ownModels ? { ownModels: true, providers: [scriptedProvider()] } : {}) }));
  }
  return modelCatalogs.get(key);
}

async function chatModelView(context) {
  if (manifestForImplementation(context.chat.backend?.implementation)?.profile) {
    const implementation = context.chat.backend.implementation;
    const manifest = manifestForImplementation(implementation);
    const adapter = backends.forChat(context.chat);
    const resident = backends.getByChatId(context.chat.id);
    if (!resident) {
      const remembered = rememberedModel(preferences, implementation);
      const models = await harnessModels.list(implementation, context.project.workingRoot, adapter, {
        require: context.chat.backend.model || remembered?.model || "",
      });
      const rememberedSpec = models.some((item) => item.spec === remembered?.model) ? remembered.model : "";
      const model = context.chat.backend.model || rememberedSpec || models[0]?.spec || "";
      // Said rather than quietly running the chat on a model nobody chose.
      const modelFallback = !context.chat.backend.model && remembered?.model && !rememberedSpec && model
        ? { from: remembered.model, to: model }
        : null;
      const selected = models.find((item) => item.spec === model);
      const defaultThinkingLevel = selected?.defaultThinkingLevel || selected?.thinkingLevels[0] || "";
      const savedThinkingLevel = context.chat.modelThinkingLevels?.[model]
        || (rememberedSpec ? remembered.thinkingLevel : "") || "";
      const thinkingLevel = selected?.thinkingLevels.includes(savedThinkingLevel) ? savedThinkingLevel : defaultThinkingLevel;
      return {
        installationId: manifest?.installationId || context.chat.backend.installationId,
        runtimeKind: implementation, models, model,
        thinkingLevel, defaultModel: models[0]?.spec || "", defaultThinkingLevel, ...(modelFallback ? { modelFallback } : {}),
        modelThinkingLevels: context.chat.modelThinkingLevels || {}, requiresAuthentication: false, warnings: [], source: "catalog",
      };
    }
    const [models, state] = await Promise.all([adapter.listModels(resident.id), adapter.getModelState(resident.id)]);
    return {
      installationId: manifest?.installationId || context.chat.backend.installationId,
      runtimeKind: implementation, models, ...state,
      defaultModel: models[0]?.spec || "",
      defaultThinkingLevel: models.find((item) => item.spec === state.model)?.defaultThinkingLevel || "",
      modelThinkingLevels: context.chat.modelThinkingLevels || {},
      requiresAuthentication: false, warnings: [], source: "live",
    };
  }
  const template = templateForChat(context.chat, context.project);
  const runtime = runtimeFor({ runtimeKind: "conduit_profile", template });
  const catalog = catalogFor(runtime, template);
  const catalogView = await catalog.list(context.project.workingRoot);
  let model = context.chat.backend?.model || catalogView.defaultModel;
  let thinkingLevel = context.chat.modelThinkingLevels?.[model] || catalogView.defaultThinkingLevel;
  let source = context.chat.backend?.model ? "chat_preference" : "runtime_default";
  let chatOwnsModel = Boolean(context.chat.backend?.model);
  // A chat that already ran on a model of its own keeps it: the profile's remembered model only fills in a new chat's
  // blank, and a substitution for it is reported rather than made quietly.
  const remembered = rememberedModel(preferences, template?.id);
  let modelFallback = null;
  if (!chatOwnsModel && remembered?.model) {
    if (catalogView.models.some((item) => item.spec === remembered.model)) {
      model = remembered.model;
      thinkingLevel = remembered.thinkingLevel || thinkingLevel;
      source = "profile_default";
    } else if (model) {
      modelFallback = { from: remembered.model, to: model };
    }
  }
  const resident = backends.getByChatId(context.chat.id);
  let models = catalogView.models;
  if (resident) {
    const adapter = backends.forChat(context.chat);
    const [available, state] = await Promise.all([
      adapter.listModels(resident.id),
      adapter.getModelState(resident.id),
    ]);
    const enabled = new Set(catalogView.models.map((item) => item.spec));
    const liveModels = available;
    models = enabled.size ? liveModels.filter((item) => enabled.has(item.spec)) : liveModels;
    model = state.model || model;
    thinkingLevel = state.thinkingLevel || thinkingLevel;
    const currentModel = liveModels.find((item) => item.spec === model);
    if (currentModel && !models.some((item) => item.spec === model)) models = [...models, currentModel];
    // A running process has a real model; nothing was substituted for it.
    modelFallback = null;
    source = "live";
  }
  if (model && !models.some((item) => item.spec === model)) {
    const [provider, ...modelParts] = model.split("/");
    models = [...models, {
      provider,
      id: modelParts.join("/"),
      spec: model,
      label: modelParts.at(-1) || model,
      reasoning: thinkingLevel !== "off",
      thinkingLevels: thinkingLevel ? [...new Set(["off", thinkingLevel])] : ["off"],
      outsideScope: true,
    }];
  }
  const selectedModel = models.find((item) => item.spec === model);
  if (selectedModel) thinkingLevel = resolveThinkingLevel(thinkingLevel, selectedModel.thinkingLevels, catalogView.defaultThinkingLevel);
  return {
    installationId: runtime.installationId,
    runtimeKind: runtime.kind,
    models,
    model,
    thinkingLevel,
    modelThinkingLevels: context.chat.modelThinkingLevels || {},
    defaultModel: catalogView.defaultModel,
    defaultThinkingLevel: catalogView.defaultThinkingLevel,
    requiresAuthentication: catalogView.requiresAuthentication,
    warnings: catalogView.warnings,
    ...(modelFallback ? { modelFallback } : {}),
    source,
  };
}

function templateForId(templateId) {
  return resolveTemplate(config, templateId) || defaultTemplate();
}

function templateForChat(chat, project = null) {
  if (chat?.templateId) return templateForId(chat.templateId);
  if (project?.defaultTemplateId) return templateForId(project.defaultTemplateId);
  return defaultTemplate();
}

function runtimeFor({ runtimeKind = "conduit_profile", template }) {
  if (runtimeKind !== "conduit_profile") throw Object.assign(new Error("Unknown Conduit runtime"), { code: "unknown_runtime_kind", status: 400 });
  return {
    kind: "conduit_profile",
    installationId: "conduit-runtime",
    profileId: template.id,
    profileVersion: template.version,
  };
}

// The LAN name exists to be a secure context: plain http to it goes to https
// on the same port, which already speaks both.
app.use((req, res, next) => {
  if (!lanNameMatches(req.hostname)) return next();
  // Remembered, so the next typed address skips the plain-http hop.
  if (req.socket.encrypted) { res.setHeader("Strict-Transport-Security", "max-age=31536000"); return next(); }
  res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
});
// Every response: never sniffed into another type, no full URL in a Referer sent off the hub, and over
// HTTPS (a LAN name's TLS, or a proxy's that says so) remembered as HTTPS-only, closing the first visit's plain hop.
// No framing rule: the gallery frames Conduit from another of its own names, and nothing else frames it.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  if (secureRequest(req) && !res.getHeader("Strict-Transport-Security")) res.setHeader("Strict-Transport-Security", "max-age=31536000");
  next();
});
app.use(compression());
app.use(nativeCors);

// Ahead of authentication because the updater runs in the shell and carries no session: the artifacts are signed,
// and a signature is what makes an update safe to install, not the secrecy of the URL it came from.
const desktopUpdateDir = process.env.CONDUIT_DESKTOP_UPDATE_DIR;
if (desktopUpdateDir) {
  console.warn(`Serving desktop update artifacts from ${desktopUpdateDir} (development only).`);
  app.use("/desktop-updates", express.static(desktopUpdateDir, {
    index: false,
    dotfiles: "deny",
    fallthrough: false,
    setHeaders: (response) => response.setHeader("Cache-Control", "no-store"),
  }));
}
// The folder is on the Windows drive, where a listing costs ~30 ms, so one listing serves for ten seconds.
let downloadsListed = null;
app.get("/v0/downloads", async (_request, response) => {
  const newest = async (suffix) => {
    if (!desktopUpdateDir) return null;
    const names = (await fs.readdir(desktopUpdateDir).catch(() => [])).filter((name) => name.endsWith(suffix));
    const dated = await Promise.all(names.map(async (name) => ({ name, at: (await fs.stat(path.join(desktopUpdateDir, name))).mtimeMs })));
    const found = dated.sort((left, right) => right.at - left.at)[0];
    return found ? { url: `/desktop-updates/${encodeURIComponent(found.name)}`, name: found.name } : null;
  };
  if (!downloadsListed || Date.now() - downloadsListed.at > 10_000) {
    const listed = { at: Date.now(), urls: Promise.all([newest("-setup.exe"), newest(".apk")]) };
    listed.urls.catch(() => { if (downloadsListed === listed) downloadsListed = null; });
    downloadsListed = listed;
  }
  const [windows, apk] = await downloadsListed.urls;
  // A dev APK is named for the version it was stamped with: the dev app's updater compares that with its own.
  const apkVersion = apk?.name.match(/^Conduit Dev_(.+)\.apk$/)?.[1] || null;
  response.set("Cache-Control", "no-store").json({ windowsUrl: windows?.url || null, apkUrl: apk?.url || null, apkVersion });
});

// Ahead of authentication like the compiled client it is made of: it carries nobody's data.
const clientBundle = createClientBundle(dist);
// Read again every 20 s: a build lands in dist or the update folder without the hub restarting.
const readOffer = async () => {
  const offer = { interface: (await clientBundle.manifest().catch(() => null))?.build || null, desktop: null };
  if (desktopUpdateDir) offer.desktop = JSON.parse(await fs.readFile(path.join(desktopUpdateDir, "latest.json"), "utf8").catch(() => "null"))?.version || null;
  return offer;
};
const offerUpdates = () => void readOffer().then((offer) => runtimeHub.offerUpdates(offer)).catch(() => {});
offerUpdates();
const offerTimer = setInterval(offerUpdates, 20_000);
offerTimer.unref?.();
app.get("/client-bundle/manifest.json", async (_request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.json(await clientBundle.manifest());
});
app.get("/client-bundle/:build.zip", async (request, response) => {
  const zip = await clientBundle.zip(request.params.build);
  if (!zip) { response.status(404).end(); return; }
  response.setHeader("Content-Type", "application/zip");
  response.setHeader("Cache-Control", "no-store");
  response.end(zip);
});

// The hub's token lets a harness in ahead of the sign-in check; a signed-in caller reaches the same endpoint below.
// `mcpRuntime` is filled in as its parts are made.
const mcpRuntime = {};
const mcpHost = /^(0\.0\.0\.0|::|\[::\]|)$/.test(config.host || "") ? "127.0.0.1" : String(config.host).includes(":") && !String(config.host).startsWith("[") ? `[${config.host}]` : config.host;
Object.assign(mcpAccess, { url: `http://${mcpHost}:${config.port}/v0/mcp`, token: mcpToken(config.dataRoot) });
const mcp = createMcpEndpoint({ runtime: mcpRuntime, token: mcpAccess.token });
app.use(mcp.beforeAuth);

// One proxy per origin Conduit is opened at, as a proxied page may be framed only by that origin. Made on first use; a proxied page's origin is a port of this host, which a cookie does not
// tell apart from Conduit's own, so nothing from one is answered here (below, and on upgrades).
const browserProxies = new Map();
const fromProxiedPage = (request) => { const origin = request.headers.origin; return Boolean(origin) && [...browserProxies.values()].some((proxy) => proxy.isProxyOrigin(origin)); };
const browserProxyFor = (request) => {
  const origin = request.headers.origin;
  if (!origin || !browserHost.settings.direct) return null;
  let host;
  try { host = new URL(origin).host; } catch { return null; }
  if (host !== request.headers.host) return null;
  if (!browserProxies.has(origin)) browserProxies.set(origin, createBrowserProxy({ conduitOrigin: origin, host: config.host, cookieNames: ["conduit_session"] }));
  return browserProxies.get(origin);
};
app.use((request, response, next) => fromProxiedPage(request) ? response.status(403).json({ error: "from_proxied_page" }) : next());

const requireAuth = prepareAuthMiddleware(authStore);
app.use(requireAuth);

async function findChatContext(chatId) {
  if (!isChatId(chatId)) return null;
  let chat = registry.metadata(chatId);
  if (!chat) return null;
  // An untracked thread's chat can sit in any folder on the Computer, not only
  // in a workspace.
  const project = await projects.get(chat.projectId) || await resolveComputerContext(chat.projectId).catch(() => null);
  if (!project) return null;
  if (!chat.projectId.startsWith("computer:")) await projects.validate(project);
  return { chat, project };
}

registerAttachmentRoutes(app, { attachments, findChatContext });

app.use("/v0/context", express.json({ limit: "256kb" }));
app.use(["/v0/markup", "/v0/document"], express.json({ limit: "4mb" }));
app.use(express.json({ limit: "128kb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));
app.use(mcp.afterAuth);

app.get("/v0/chatgpt-web/status", async (_request, response, next) => {
  response.json(await requireChatgptWeb().health());
});
app.put("/v0/chatgpt-web/credential", async (request, response, next) => {
  response.json(await requireChatgptWeb().setCredential(String(request.body?.cookie || "")));
});
app.delete("/v0/chatgpt-web/credential", async (_request, response, next) => {
  response.json(await requireChatgptWeb().removeCredential());
});

registerAuthRoutes(app, { authStore, socketTickets, clientDist: dist, throttleFile: path.join(config.dataRoot, "auth", "login-throttle.json") });

let shuttingDown = false;
const checkpointWorkspace = async (project) => ((await backends.capabilities(project))?.checkpoints ? projectWorkspace(project, nodeHub) : null);
// Closed before the chat is told the turn settled: the client reads its changes then.
async function closeTurnCheckpoint(record, turnId) {
  const unchanged = !record.ranTools;
  record.ranTools = false;
  try {
    const context = await findChatContext(record.chatId);
    const at = context ? await checkpointWorkspace(context.project) : null;
    if (at) await turnCheckpoints.close({ chatId: record.chatId, workingRoot: at, turnId, unchanged });
  } catch (error) { console.warn("Could not close turn checkpoint", error.message); }
}
function checkpointNativeAdapter(adapter, record, completed = true) {
  const completedAt = new Date().toISOString();
  // A cancelled or failed turn is activity, so it moves the sort key -- but it
  // completed nothing, so it leaves nothing to read.
  void registry.update(record.chatId, { backend: { ...registry.metadata(record.chatId)?.backend, opaqueSession: adapter.opaqueSessionOf?.(record) ?? record.sessionId },
    ...(record.title ? { title: record.title } : {}),
    ...(completed ? { lastAssistantCompletedAt: completedAt } : {}),
    lastMessageAt: completedAt })
    .then((chat) => {
      record.lastCheckpoint = { type: "session_checkpoint", generationId: record.generation?.id || null,
        chatId: chat.id, title: chat.title || null };
      adapter.publish(record, record.lastCheckpoint);
      runtimeHub.publish({ type: "chat_changed", chat: chatView(chat), at: completedAt });
    })
    .catch((cause) => console.error("Could not checkpoint native chat", cause));
}
async function applyBackendName(adapter, record, name) {
  if (!await registry.fallbackTitle(record.chatId, name)) return;
  const chat = registry.metadata(record.chatId);
  adapter.publish(record, { type: "session_checkpoint", generationId: record.generation?.id || null,
    chatId: chat.id, title: chat.title });
  runtimeHub.publish({ type: "chat_changed", chat: chatView(chat), at: new Date().toISOString() });
}
for (const adapter of backends.instances()) {
  adapter.on?.("settled", ({ record, completed }) => {
    // An ephemeral record -- a probe -- has no chat to checkpoint.
    if (record.ephemeral) return;
    // The chat is told once its checkpoint is closed, or after a moment: a first snapshot of a large folder goes on behind.
    const closed = closeTurnCheckpoint(record, record.generation?.id || null);
    void Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 3_000).unref())])
      .then(() => checkpointNativeAdapter(adapter, record, completed !== false));
  });
  adapter.on?.("changed", ({ record, reason, name }) => {
    publishProcessChange(adapter.view(record), record, reason);
    if (reason === "named" && name) void applyBackendName(adapter, record, name)
      .catch((cause) => console.error("Could not apply backend chat name", cause));
  });
  adapter.on?.("removed", ({ id, chatId }) => runtimeHub.publishProcessRemoved(id, chatId));
  if (adapter.sessions) adapter.sessions.onTurn = (record) => publishProcessChange(adapter.view(record), record, "turn");
  adapter.on?.("tool_input", ({ chatId, name, input, call, done }) => { if (name === "conduit_paper") void artifactHeard(chatId, input, call, done); });
}
registerDraftRoutes(app, { drafts, knownChat: async (chatId) => Boolean(await findChatContext(chatId)) });
registerContextRoutes(app, { contextStore });
registerClientReportRoutes(app, { dataRoot: config.dataRoot });
const uiControl = new UiControl({ runtimeHub, nodeHub });
mcpRuntime.uiControl = uiControl;
const feedback = lifetime.own("feedback", createFeedback({ dataRoot: config.dataRoot, config, serverName: serverIdentity.name, runtimeHub, uiControl, chatLogs, listProcesses: () => backends.list() }), (owned) => owned.close());
registerMarkupRoutes(app, "/v0/markup", () => feedback);
// Made at its first use, when everything it names exists: a paper's mated thread and connected chats are the hub's own chats.
let paperChatHost;
const paperChats = () => (paperChatHost ??= createChatHost({ registry, projects, backends, chatLogs, findChatContext, launchLiveSession, contextStore, submitPrompt: (...args) => liveSessionStream.submitPrompt(...args) }));
const documents = lifetime.own("documents", createDocuments({ dataRoot: config.dataRoot, projects, devices: (project) => projectWorkspace(project, nodeHub), changed: (projectId) => runtimeHub.publish({ type: "artifacts_changed", projectId }),
  chats: () => ({ open: (asked) => paperChats().openChat(asked), notify: (id, text, markup) => paperChats().deliverApproval(id, text, { markup }), get: (id) => { const chat = registry.metadata(id); return chat ? chatView(chat) : null; }, working: (id) => isGeneratingRecord(backends.getByChatId(id)) }) }), (owned) => owned.close());
artifactTurned = (chat) => documents.turned(chat);
artifactHeard = (chat, input, call, done) => documents.heard(chat, input, call, done).catch(() => {});
registerDocumentRoutes(app, documents);
mcpRuntime.documents = documents;
onWorkspaceChange((projectIds) => documents.filesChanged(projectIds));
registerMarkupRoutes(app, "/v0/document/:document/markup", (request) => documents.markup(request.params.document));
const browserHost = lifetime.own("hub browser", new BrowserHost({ dataRoot: config.dataRoot,
  onChange: () => runtimeHub.publish({ type: "browser_changed", id: "hub" }) }), (owned) => owned.close());
mcpAccess.browser = browserHost.mcpServer();
const personBrowser = lifetime.own("person's browser", new PersonBrowser(), (owned) => owned.close());
const personBrowsers = createPersonBrowsers({ own: personBrowser, nodeHub });
mcpRuntime.personBrowsers = personBrowsers;
registerPersonBrowserRoutes(app, { personBrowsers });
const browsers = createBrowsers({ hub: browserHost, nodeHub, tunnelTo });
registerBrowserRoutes(app, { browsers, proxy: browserProxyFor });
const screens = createScreens({ browsers, uiControl });
mcpRuntime.screens = screens;
registerSkillRoutes(app, { skills });
registerRuntimeRoutes(app, {
  uiControl,
  attachments,
  config,
  currentMagicDnsOrigin,
  formatWorkspacePath,
  isPathInside,
  isShuttingDown: () => shuttingDown,
  listDirectorySuggestions,
  preferences,
  resolveTemplate,
  runtimeHub,
  templatePublicView,
  projects,
  serverIdentity,
  onServerRenamed: (name) => lanAdvertisement.rename(name),
  onAccountRenamed: async (patch) => {
    const agent = backends.adapters.get("conduit-runtime")?.runtime.agent;
    // An emptied name leaves the agent's as it was; an emptied home clears it.
    const person = Object.fromEntries(Object.entries(patch).filter(([field, value]) => value || field === "home"));
    if (agent?.folder && Object.keys(person).length) await writePerson(agent.folder, person);
  },
  webToolsError: () => backends.adapters?.get("conduit-runtime")?.runtime?.webToolsError || null,
});

registerAccountRoutes(app, { dataRoot: config.dataRoot });

registerPiAuthRoutes(app, {
  piAuth,
});

registerSearchRoutes(app, {
  searchSettings,
});
registerVoiceRoutes(app, { voiceSettings, voiceRuntime, voiceModel, voiceHistory: new VoiceHistory({ filePath: path.join(config.dataRoot, "voice", "history.json") }) });

registerPtyRoutes(app, { projects, terminals, nodeHub });
registerTerminalPasteRoutes(app, { terminalPastes });

registerNodeRoutes(app, { nodeHub, config, lanNameMatches: (name) => lanNameMatches(name), lanNames: hubLanNames });
registerNetworkRoutes(app, { lanNames: networkLanNames });
registerProjectRoutes(app, {
  nodeHub,
  backends,
  buildProjectDashboard,
  config,
  listWorkspaceDirectory,
  modelCatalog,
  preferences,
  projects,
  readWorkspaceCommit,
  readWorkspaceDiff,
  readWorkspaceFile,
  readWorkspaceFileMetadata,
  readWorkspaceVersion,
  runWorkspaceGitAction,
  registry,
  terminals,
  lifecycle,
  turnCheckpoints,
});
const launchLiveSession = registerLiveSessionRoutes(app, {
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
  // Bound late: the live-session stream is made below.
  promptChat: (...args) => liveSessionStream.promptChat(...args),
});
registerChatRoutes(app, {
  announceChat: (chat) => runtimeHub.publish({ type: "chat_changed", chat, at: new Date().toISOString() }),
  backends,
  nodeHub,
  catalogFor,
  chatModelView,
  lifecycle,
  config,
  defaultTemplate,
  findChatContext,
  launchLiveSession,
  modelCatalog,
  preferences,
  projects,
  registry,
  templateForChat,
});
registerHarnessRoutes(app, { backends, harnessModels, preferences, projects, registry });
const hostUi = createHostUi({ backends, registry,
  respondHostUi: (...args) => liveSessionStream.respondHostUi(...args) });
hostUi.registerRoutes(app);
lifetime.interval("host UI deadlines", () => hostUi.sweep(), 1000);
// Bound late: the live-session stream is made below.
registerRunRoutes(app, {
  backends, chatLogs, config, defaultTemplate, launchLiveSession, projects, registry, runtimeFor,
  submitPrompt: (...args) => liveSessionStream.submitPrompt(...args),
  stopGeneration: (...args) => liveSessionStream.stopGeneration(...args),
});
// The hub's own key pair signs every message, so the file is the hub's alone.
const push = new PushService({ file: path.join(config.dataRoot, "push.json"),
  subject: process.env.CONDUIT_PUSH_SUBJECT || "mailto:conduit@localhost" });
await push.load();
const durableAdapter = backends.adapters.get("conduit-runtime") || null;
if (durableAdapter) {
  durableAdapter.runtime.uiControl = uiControl;
  durableAdapter.runtime.screens = screens;
  durableAdapter.runtime.browserHost = browserHost;
  durableAdapter.runtime.personBrowsers = personBrowsers;
  durableAdapter.runtime.documents = documents;
  void durableAdapter.runtime.loadBrowserTools();
}
const persistentAgent = durableAdapter ? new PersistentAgent({ runtime: durableAdapter.runtime, registry, projects, launchLiveSession, findChatContext }) : null;
registerPushRoutes(app, { push, hubId: () => serverIdentity.id, agent: persistentAgent });
if (persistentAgent) {
  mcpRuntime.agent = persistentAgent;
  mcpRuntime.lastAnswer = (...args) => durableAdapter.runtime.lastAnswer(...args);
  persistentAgent.chatHost = createChatHost({ registry, projects, backends, chatLogs, findChatContext, launchLiveSession, contextStore,
    submitPrompt: (...args) => liveSessionStream.submitPrompt(...args) });
  persistentAgent.settingsListeners.add(() => seedSchedules(persistentAgent));
  durableAdapter.runtime.agentNotify = agentNotifier({ agent: persistentAgent, push, hubId: () => serverIdentity.id, hubName: () => serverIdentity.name });
  durableAdapter.runtime.reviewModel = () => { const preference = preferences.get(); return preference.reviewModel || preference.sessionNameModel || null; };
  // Kept apart from jbot's thread, so it outlives a reset.
  const messageLog = await new MessageLog(path.join(config.dataRoot, "agent", "messages.jsonl")).load();
  durableAdapter.runtime.messageLog = messageLog;
  const emailChannel = await new EmailChannel({ file: path.join(config.dataRoot, "agent", "email.json"), agent: persistentAgent, log: messageLog }).load();
  messageLog.channels.email = emailChannel;
  emailChannel.start();
  lifetime.own("jbot email", emailChannel, (owned) => owned.stop());
  void mirrorHomeThread(persistentAgent, messageLog).then((unsubscribe) => lifetime.own("jbot message log", { stop: unsubscribe }, (owned) => owned.stop()))
    .catch((error) => console.error("[agent] message log mirror did not start", error));
  registerAgentRoutes(app, { agent: persistentAgent, backends, hubId: serverIdentity.id, voiceRuntime });
  let agentChange = null;
  const agentChanged = () => { agentChange ??= setTimeout(() => { agentChange = null; runtimeHub.publish({ type: "agent_changed", at: new Date().toISOString() }); }, 1000); };
  onWorkChanged(agentChanged);
  durableAdapter.runtime.agentChanged = agentChanged;
  durableAdapter.runtime.workActivity = async (conversationId) => {
    const work = await (await durableAdapter.runtime.open()).snapshot(WorkLog, persistentAgent.context).catch(() => null);
    if (Object.values(work?.items || {}).some((item) => !item.endedAt && String(item.conversationId) === String(conversationId))) agentChanged();
  };
  const stopEvents = startEvents(persistentAgent, { nodeHub, runtimeHub, backends, registry, chatLogs, onWorkspaceChange });
  lifetime.own("persistent agent connectors", persistentAgent.connectors, (owned) => owned.stop());
  lifetime.own("jbot inbox files", persistentAgent, (owned) => owned.stopFollowing());
  lifetime.own("persistent agent events", { stop: stopEvents }, (owned) => owned.stop());
  void persistentAgent.load().then((project) => project && Promise.all([seedSchedules(persistentAgent), armReminders(persistentAgent)]))
    .catch((error) => console.error("[agent] could not load", error));
}
registerDiagnosticsRoutes(app, { dataRoot: config.dataRoot });
registerSessionContextRoutes(app, { backends, findChatContext });
registerSessionRoutes(app, {
  attachments,
  backends,
  chatLogs,
  drafts,
  findChatContext,
  lifecycle,
  sessionNames,
  projects,
  registry,
});
// A cached service worker pins the whole client to a build that is no longer there. `no-store` rather than
// `no-cache` because a CDN in front of this may rewrite a revalidating header into a browser TTL of its own.
const WORKER_SCRIPTS = /^(sw|service-worker|registerSW|workbox-[^/]+)\.js$/;

const galleryDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist-gallery");
app.get("/gallery", (request, response, next) => request.path === "/gallery" ? response.redirect("/gallery/") : next());
app.use("/gallery", express.static(galleryDist, {
  index: "gallery.html",
  fallthrough: false,
  setHeaders(response, file) {
    response.setHeader("Cache-Control", file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache");
  },
}));

// Names are content hashes, so a precompressed copy never goes stale.
app.get(/^\/assets\/[\w.-]+$/, (request, response, next) => {
  const accepts = String(request.headers["accept-encoding"] || "");
  const encoding = /\bbr\b/.test(accepts) ? "br" : /\bgzip\b/.test(accepts) ? "gzip" : null;
  if (!encoding) return next();
  const file = path.join(dist, request.path);
  const copy = `${file}.${encoding === "br" ? "br" : "gz"}`;
  response.setHeader("Vary", "Accept-Encoding");
  response.type(path.extname(file));
  response.sendFile(path.basename(copy), {
    root: path.dirname(copy),
    dotfiles: "deny",
    headers: { "Content-Encoding": encoding, "Cache-Control": "public, max-age=31536000, immutable" },
  }, (error) => {
    if (!error) return;
    if (response.headersSent) return next(error);
    response.removeHeader("Content-Encoding");
    response.removeHeader("Content-Type");
    next();
  });
});
app.use(express.static(dist, {
  setHeaders(response, file) {
    if (WORKER_SCRIPTS.test(path.basename(file))) response.setHeader("Cache-Control", "no-store, must-revalidate");
    else if (file.includes(`${path.sep}assets${path.sep}`)) response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    else response.setHeader("Cache-Control", "no-cache");
  },
}));
app.get("/{*splat}", (request, response, next) => {
  if (request.path.startsWith("/v0/") || request.path === "/healthz") return next();
  response.setHeader("Cache-Control", "no-cache");
  response.sendFile("index.html", { root: dist });
});
app.use((error, _request, response, _next) => {
  let status = error.status || 500;
  if (["reserved_project", "workspace_already_linked", "clone_target_reserved", "clone_reservation_lost", "workspace_cloning"].includes(error.code)) status = 409;
  if (error.code === "workspace_identity_changed") status = 409;
  if (["chat_move_not_supported", "live_session_starting", "runtime_locked", "session_writer_conflict", "session_name_model_required"].includes(error.code)) status = 409;
  if (error.code === "live_process_limit" || error.code === "generation_limit" || error.code === "pty_capacity_reached") status = 429;
  if (["attachment_not_found", "path_not_found", "pty_project_not_found"].includes(error.code)) status = 404;
  if (error.code === "attachment_too_large") status = 413;
  if (["pty_not_running", "pty_cwd_unavailable", "pty_home_unavailable"].includes(error.code)) status = 409;
  if (error.code === "command_failed") status = 502;
  if (error.code === "clone_timeout") status = 504;
  if (error.code === "invalid_attachment_id"
    || [
      "enabled_models_required",
      "invalid_enabled_model",
      "invalid_default_model",
      "path_not_allowed",
      "path_not_absolute",
      "path_not_directory",
      "workspace_path_exists",
      "workspace_directory_invalid",
      "workspace_preview_mode_invalid",
      "dangerous_workspace_root",
      "unsafe_conduit_path",
      "clone_url_required",
      "clone_target_exists",
      "clone_url_not_allowed",
      "clone_url_credentials",
      "special_template",
      "special_chat_locked",
      "unknown_template",
      "unknown_runtime_kind",
      "invalid_workspace_path",
      "hidden_workspace_path",
      "workspace_path_symlink",
      "workspace_path_required",
      "invalid_workspace_move",
      "path_not_file",
      "file_too_large",
      "file_not_text",
      "pty_template_not_allowed",
      "pty_project_required",
      "pty_cwd_required",
      "pty_resize_invalid",
      "pty_input_invalid",
      "pty_control_invalid",
      "search_config_invalid",
      "search_key_invalid",
      "search_provider_locked",
      "search_provider_unknown",
      "model_profile_required",
      "model_profile_unresolved",
      "model_profile_overlay_invalid",
      "model_profile_search_config_invalid",
    ].includes(error.code)
    || error.message?.includes("Project names")) status = 400;
  // A stack for what went wrong here; an answer the request was meant to get (not text, not found, its device
  // away) is the client's to show, and only a line here.
  if (status >= 500 && error.code !== "device_offline") console.error(error);
  else console.warn(`[conduit] ${status} ${error.code || "error"}: ${error.message}`);
  response.status(status).json({
    error: error.code || "runtime_error",
    message: error.message,
    path: error.path,
    kind: error.kind,
    mime: error.mime,
    size: error.size,
    modifiedAt: error.modifiedAt,
    revision: error.revision,
    head: error.head,
    allowlist: error.allowlist,
    maxBytes: error.maxBytes,
  });
});

const server = http.createServer(app);
// Owned before the sockets and streams it carries, so it is released after them: a browser socket gets its
// "restarting" close before the connection under it goes. The listener closes only once every connection it handed
// over does, so the two servers close with it.
lifetime.own("listener", null, async () => {
  const closed = new Promise((resolve) => front.close(resolve));
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  secureServer?.close();
  secureServer?.closeAllConnections?.();
  // The sockets' own goodbyes (a browser socket's "restarting") went out before this; end what is left, and cut what
  // does not end within a second.
  for (const socket of frontSockets) socket.end();
  const cut = setTimeout(() => { for (const socket of frontSockets) socket.destroy(); }, 1_000);
  await closed;
  clearTimeout(cut);
});
// A streamed frame repeats the same keys and ids (~224 bytes for a 4-byte delta); with the context kept across frames
// it compresses to ~11 bytes. Level 1 at memLevel 7 keeps the cost per socket and per frame small.
const socketDeflate = { threshold: 64, zlibDeflateOptions: { level: 1, memLevel: 7 } };
const closeOnRestart = (owned) => {
  for (const socket of owned.clients) socket.close(1012, "Conduit is restarting");
};
const wss = lifetime.own("browser sockets", new WebSocketServer({ noServer: true, perMessageDeflate: socketDeflate }), closeOnRestart);
const terminalStream = lifetime.own("terminal streams", createTerminalStream({ terminals, perMessageDeflate: socketDeflate }), (owned) => owned.shutdown?.({ timeoutMs: 1_000 }));
// Dictation sends audio, which deflate only spends time on.
const dictationSockets = lifetime.own("dictation sockets", new WebSocketServer({ noServer: true }), closeOnRestart);
const dictationStream = createDictationStream({
  wss: dictationSockets,
  voiceRuntime,
  recordingStore: voiceRecordingStore,
  limits: {
    finalizationBaseMs: config.voiceFinalizationBaseMs,
    finalizationMaxMs: config.voiceFinalizationMaxMs,
    finalizationDefaultMultiplier: config.voiceFinalizationDefaultMultiplier,
  },
});
lifetime.own("dictation streams", dictationStream, (owned) => owned.shutdown?.({ timeoutMs: 1_000 }));
const liveSessionStream = createLiveSessionStream({
  sentFrom: (chatId, client) => uiControl.sentFrom(chatId, client),
  backends,
  concurrency,
  maxGeneratingProcesses: () => runtimeSettings.get().maxGeneratingProcesses,
  wss,
  attachments,
  registry,
  config,
  turnCheckpoints,
  checkpointWorkspace,
  findChatContext,
  chatModelView,
  chatLogs,
  lifecycle,
  async autoNameSession(record, context, message) {
    const task = sessionNames.run({
      chatId: context.chat.id,
      cwd: context.project.workingRoot,
      source: "first_prompt",
      message,
      apply: async (name) => {
        const currentTitle = registry.metadata(context.chat.id)?.title;
        if (currentTitle && currentTitle !== "New chat") return "not_applied_title_already_set";
        const updated = await registry.update(context.chat.id, { title: name });
        backends.adapterForRecord(record).publish(record, {
          type: "session_checkpoint",
          chat: chatView(updated),
          generationId: record.generation?.id || null,
        });
        runtimeHub.publish({ type: "chat_changed", chat: chatView(updated), at: new Date().toISOString() });
        return "applied";
      },
    });
    sessionNameTasks.set(context.chat.id, task);
    try {
      await task;
    } finally {
      if (sessionNameTasks.get(context.chat.id) === task) sessionNameTasks.delete(context.chat.id);
    }
  },
});

// One handler for both listeners: a second copy would be a second place for an authentication check to drift.
const handleUpgrade = async (request, socket, head) => {
  const requestUrl = new URL(request.url, "http://localhost");
  const pathname = requestUrl.pathname;
  if (fromProxiedPage(request)) return socket.destroy();
  const match = pathname.match(/^\/v0\/live-sessions\/([a-f0-9-]{24,36})\/stream$/);
  const ptyMatch = pathname.match(/^\/v0\/ptys\/([a-f0-9-]{36})\/attach$/);
  const dictationMatch = pathname === "/v0/dictation/stream";
  const browserMatch = pathname.match(/^\/v0\/browsers\/([A-Za-z0-9_-]{1,64})\/stream$/);
  const documentMatch = pathname.match(/^\/v0\/document\/([a-z0-9-]{1,64})\/live$/);
  // A device dialling in proves itself with its pairing key, not a browser session.
  if (pathname === "/v0/nodes/connect") return nodeHub.handleUpgrade(request, socket, head);
  if ((!match || !backends.get(match[1])) && (!ptyMatch || !terminals.get(ptyMatch[1])) && !dictationMatch && !documentMatch
    && (!browserMatch || !browsers.get(browserMatch[1])?.available)) return socket.destroy();
  try {
    if (authStore.hasPassword()) {
      const ticket = requestUrl.searchParams.get("ticket");
      if (ticket) {
        if (!installedClientOrigin(request.headers.origin)) return socket.destroy();
        const sessionHash = socketTickets.consume(ticket);
        const session = await authStore.findSessionHash(sessionHash);
        if (!session || session.kind !== "native") return socket.destroy();
        await authStore.touchSession(session);
      } else {
        const context = await validateSession(authStore, request);
        if (!context) return socket.destroy();
      }
    }
  } catch (error) {
    console.error("WebSocket session validation failed", error);
    return socket.destroy();
  }
  if (dictationMatch) return dictationStream.handleUpgrade(request, socket, head);
  if (documentMatch) return documents.handleUpgrade(documentMatch[1], request, socket, head);
  if (browserMatch) return browsers.get(browserMatch[1]).handleUpgrade(browserMatch[1], request, socket, head);
  if (ptyMatch) return terminalStream.handleUpgrade(ptyMatch[1], request, socket, head);
  if (!backends.get(match[1])) return socket.destroy();
  return liveSessionStream.handleUpgrade(match[1], request, socket, head);
};
server.on("upgrade", handleUpgrade);

/*
 * Neither server listens: `front` reads the first byte of each connection and hands it to one. A TLS ClientHello
 * always opens with a handshake record (0x16) and no HTTP request starts with that byte, so the choice is exact. One
 * port means one firewall rule and nothing extra to forward through a tunnel.
 * A browser on the LAN needs a certificate it already trusts before it treats the page as a secure context
 * (microphone, service worker), so a ClientHello naming a LAN name gets the publicly trusted one; the rest get the leaf.
 */
const LAN_TLS_CERT = process.env.CONDUIT_LAN_TLS_CERT || path.join(os.homedir(), ".conduit", "tls", "lan-cert.pem");
const LAN_TLS_KEY = process.env.CONDUIT_LAN_TLS_KEY || path.join(os.homedir(), ".conduit", "tls", "lan-key.pem");
let lanTls = null;
async function loadLanTls() {
  try {
    const [cert, key] = await Promise.all([fs.readFile(LAN_TLS_CERT, "utf8"), fs.readFile(LAN_TLS_KEY, "utf8")]);
    if (lanTls?.cert === cert) return;
    const names = new crypto.X509Certificate(cert).subjectAltName?.split(", ").filter((entry) => entry.startsWith("DNS:")).map((entry) => entry.slice(4).toLowerCase()) || [];
    lanTls = { cert, names, context: tls.createSecureContext({ cert, key }) };
    console.log(JSON.stringify({ type: "conduit.lan-tls", state: "loaded", names }));
  } catch (error) {
    if (error.code !== "ENOENT") console.warn("Conduit could not load its LAN certificate", error.message);
    lanTls = null;
  }
}
await loadLanTls();
networkLanNames.start();
const lanNameMatches = (servername) => {
  const name = String(servername || "").toLowerCase();
  const parent = name.split(".").slice(1).join(".");
  return Boolean(lanTls?.names.some((pattern) => pattern === name || (pattern.startsWith("*.") && pattern.slice(2) === parent)));
};
const secureServer = serverLeaf
  ? https.createServer({
    cert: serverLeaf.certificate,
    key: serverLeaf.privateKey,
    SNICallback: (servername, done) => done(null, lanNameMatches(servername) ? lanTls.context : null),
  }, app)
  : null;
secureServer?.on("upgrade", handleUpgrade);
const TLS_HANDSHAKE = 0x16;
const FIRST_BYTE_TIMEOUT_MS = 30_000;
// Every connection the listener holds, for shutdown: upgraded sockets and ones still waiting on their first byte are
// in neither server's own list, and would hold the listener open until they time out.
const frontSockets = new Set();
const front = net.createServer((socket) => {
  frontSockets.add(socket);
  socket.once("close", () => frontSockets.delete(socket));
  socket.setTimeout(FIRST_BYTE_TIMEOUT_MS, () => socket.destroy());
  socket.once("readable", () => {
    const first = socket.read(1);
    if (!first) return socket.destroy();
    socket.setTimeout(0);
    socket.unshift(first);
    (first[0] === TLS_HANDSHAKE && secureServer ? secureServer : server).emit("connection", socket);
  });
});
const LEAF_CHECK_MS = 60 * 60 * 1000;
if (secureServer) lifetime.interval("TLS leaf check", async () => {
  try {
    await loadLanTls();
    const next = await leafStore.ensure(leafFor());
    if (next === serverLeaf) return;
    serverLeaf = next;
    secureServer.setSecureContext({ cert: next.certificate, key: next.privateKey });
    console.log(JSON.stringify({ type: "conduit.tls-leaf", state: "reissued", notAfter: new Date(next.notAfter).toISOString() }));
  } catch (error) {
    console.warn("Conduit could not re-issue its TLS leaf", error.message);
  }
}, LEAF_CHECK_MS);

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Conduit received ${signal}; stopping`);
  await lifetime.close();
  // Everything the server owns is released (each bounded by its own timeout); a handle nobody owns, such as a child's
  // pipe, must not keep the process up until the service manager kills it.
  process.exit();
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    shutdown(signal).catch((error) => {
      console.error("Conduit shutdown failed", error);
      process.exitCode = 1;
      server.closeAllConnections?.();
    });
  });
}


// Everything here shares one thread, so a slow open is usually whatever else was holding the loop; without this the
// phase timings blame whoever was waiting.
let loopCheckAt = Date.now();
lifetime.interval("event-loop check", () => {
  const drift = Date.now() - loopCheckAt - 500;
  loopCheckAt = Date.now();
  if (drift > 250) console.warn("Event loop stalled", { ms: drift });
}, 500);

// Building the catalogue costs seconds the first time, and starting an agent validates its model against it before
// spawning, so the one nearly every chat shares is warmed at boot rather than on somebody's first click.
const warmModelCatalogue = () => catalogFor(runtimeFor({ runtimeKind: "conduit_profile", template: config.piTemplate }), config.piTemplate)
  .list(process.cwd())
  .catch((error) => console.warn("Model catalogue could not be warmed", error.message));

front.listen(config.port, config.host, () => {
  console.log(
    // The bound port, not the requested one: with CONDUIT_PORT=0 the kernel picks it.
    `Conduit ${config.release} listening on http://${config.host}:${front.address().port}${secureServer ? " (and https)" : ""}`,
  );
  // Started here, with the port the kernel handed over: an address nothing listens on is worse than no advertisement.
  lanAdvertisement.start(front.address().port);
  mcpAccess.url = `http://127.0.0.1:${front.address().port}/v0/mcp`;
  void warmModelCatalogue();
});
