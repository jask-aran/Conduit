import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listPiTemplates, loadPiTemplate, normalizeTemplateId } from "../../scripts/pi-runtime.mjs";
import { expandHome, parseAllowlist } from "./workspace-paths.js";
import { PiInstallationRegistry } from "./pi-installations.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function absolute(value) {
  return path.resolve(expandHome(value));
}

function boundedMilliseconds(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1_000 ? parsed : fallback;
}

function boundedBytes(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

function boundedMultiplier(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 120 ? parsed : fallback;
}

export function loadConfig(env = process.env) {
  const templatesRoot = absolute(env.CONDUIT_TEMPLATES_ROOT || path.join(repositoryRoot, "templates"));
  let defaultTemplateFile = absolute(env.CONDUIT_PI_TEMPLATE || path.join(templatesRoot, "assistant", "template.json"));
  if (!fs.existsSync(defaultTemplateFile) && path.basename(defaultTemplateFile) === "template.json") {
    const legacyId = path.basename(path.dirname(defaultTemplateFile));
    const normalizedId = normalizeTemplateId(legacyId);
    if (normalizedId !== legacyId) defaultTemplateFile = path.join(templatesRoot, normalizedId, "template.json");
  }
  const piTemplate = loadPiTemplate(defaultTemplateFile);
  const discovered = listPiTemplates(templatesRoot);
  const byId = new Map(discovered.map((template) => [template.id, template]));
  if (!byId.has(piTemplate.id)) {
    byId.set(piTemplate.id, piTemplate);
    discovered.push(piTemplate);
    discovered.sort((a, b) => a.id.localeCompare(b.id));
  }
  const dataRoot = absolute(env.CONDUIT_DATA_ROOT || path.join(repositoryRoot, "data"));
  const filesRoot = absolute(env.CONDUIT_FILES_ROOT || path.join(dataRoot, "chat/files"));
  const workspaceAllowlist = parseAllowlist(env.CONDUIT_WORKSPACE_ALLOWLIST, {
    fallback: [os.homedir(), repositoryRoot, filesRoot],
  });
  const workspaceSuggestionRoot = absolute(env.CONDUIT_WORKSPACE_SUGGESTION_ROOT || os.homedir());
  const workspaceDefaultRoot = absolute(
    env.CONDUIT_WORKSPACE_DEFAULT_ROOT || env.CONDUIT_WORKSPACE_SUGGESTION_ROOT || os.homedir(),
  );
  const piAgentDir = absolute(env.CONDUIT_PI_AGENT_DIR || path.join(dataRoot, "pi"));
  const installations = new PiInstallationRegistry({
    conduitAgentDir: piAgentDir,
    conduitCommand: env.CONDUIT_PI_COMMAND || "",
  });
  const port = Number(env.CONDUIT_PORT || env.PORT || 4310);
  return {
    host: env.CONDUIT_HOST || env.HOST || "127.0.0.1",
    port,
    release: String(env.CONDUIT_RELEASE || "development"),
    piCommand: installations.get("conduit-pinned").command,
    repositoryRoot,
    dataRoot,
    filesRoot,
    terminalPasteRoot: absolute(env.CONDUIT_TERMINAL_PASTE_ROOT || path.join(dataRoot, "terminal-paste")),
    catalogFile: absolute(env.CONDUIT_CATALOG_FILE || path.join(dataRoot, "conduit.json")),
    sessionRegistryFile: absolute(env.CONDUIT_SESSION_REGISTRY_FILE || path.join(dataRoot, "sessions.json")),
    sessionNameLogFile: absolute(env.CONDUIT_SESSION_NAME_LOG_FILE || path.join(dataRoot, "session-name-requests.jsonl")),
    promptOverridesRoot: absolute(env.CONDUIT_PROMPT_OVERRIDES_ROOT || path.join(dataRoot, "prompt-overrides")),
    sessionNamePrompt: path.join(templatesRoot, "chat-naming", "SYSTEM.md"),
    preferencesFile: absolute(env.CONDUIT_PREFERENCES_FILE || path.join(dataRoot, "preferences.json")),
    draftsFile: absolute(env.CONDUIT_DRAFTS_FILE || path.join(dataRoot, "drafts.json")),
    piAgentDir,
    searchConfigFile: absolute(env.CONDUIT_SEARCH_CONFIG_FILE || path.join(piAgentDir, "web-search.json")),
    voiceConfigFile: absolute(env.CONDUIT_VOICE_CONFIG_FILE || path.join(dataRoot, "voice.json")),
    voiceModelRoot: absolute(env.CONDUIT_VOICE_MODEL_ROOT || path.join(dataRoot, "voice", "models")),
    voiceRecordingsRoot: absolute(env.CONDUIT_VOICE_RECORDINGS_ROOT || path.join(dataRoot, "voice", "recordings")),
    installations,
    defaultInstallationId: "conduit-pinned",
    bridgeSystemPrompt: path.join(templatesRoot, "conduit-workspace", "SYSTEM.md"),
    bridgeSkill: path.join(templatesRoot, "conduit-workspace", "SKILL.md"),
    runtimeSettingsFile: absolute(env.CONDUIT_RUNTIME_SETTINGS_FILE || path.join(dataRoot, "runtime.json")),
    identityFile: absolute(env.CONDUIT_IDENTITY_FILE || path.join(dataRoot, "identity.json")),
    leafFile: absolute(env.CONDUIT_LEAF_FILE || path.join(dataRoot, "leaf.json")),
    /*
     * The port the same server answers on over TLS.
     *
     * A second port rather than one that serves both, because telling HTTP
     * from TLS on a shared socket means sniffing the first bytes of every
     * connection, and a listener that guesses wrong is a class of bug worth
     * more than the port number saves.
     *
     * Nine above rather than one above, which is where it started and where
     * it collided immediately: `port + 1` is the universal convention for a
     * second instance of anything, so the TLS listener and a development
     * server want the same number. 4311 through 4318 are left to them, and a
     * development server on 4311 gets 4320 by the same rule.
     *
     * Once a client has pinned a certificate reached here, this cannot move
     * without breaking it, and the plain port cannot be promoted onto TLS for
     * the same reason. Both numbers are permanent from the first release that
     * pins.
     *
     * Off when the plain port is zero -- a kernel-picked port is for a test,
     * and a fixed second port there would collide with the next test.
     */
    tlsPort: Number(env.CONDUIT_TLS_PORT ?? (port ? port + 9 : 0)),
    // On by default: a server that cannot be found on the network it is on is
    // the whole reason somebody ends up typing an IP address. Off is for a
    // machine whose network is not the owner's -- a shared VPS, a work LAN --
    // where announcing the service to everyone on it is not wanted.
    advertiseOnLan: env.CONDUIT_ADVERTISE_ON_LAN !== "false",
    remotesFile: absolute(env.CONDUIT_REMOTES_FILE || path.join(dataRoot, "remotes.json")),
    authFile: absolute(env.CONDUIT_AUTH_FILE || path.join(dataRoot, "auth.json")),
    cloneTimeoutMs: boundedMilliseconds(env.CONDUIT_CLONE_TIMEOUT_MS, 120_000),
    maxAttachmentBytes: boundedBytes(env.CONDUIT_MAX_ATTACHMENT_BYTES, 100 * 1024 * 1024),
    voiceFinalizationBaseMs: boundedMilliseconds(env.CONDUIT_VOICE_FINALIZATION_BASE_MS, 30_000),
    voiceFinalizationMaxMs: boundedMilliseconds(env.CONDUIT_VOICE_FINALIZATION_MAX_MS, 600_000),
    voiceFinalizationDefaultMultiplier: boundedMultiplier(env.CONDUIT_VOICE_FINALIZATION_DEFAULT_MULTIPLIER, 12),
    allowInsecure: env.CONDUIT_ALLOW_INSECURE === "1",
    templatesRoot,
    workspaceAllowlist,
    workspaceDefaultRoot,
    workspaceSuggestionRoot,
    piTemplates: discovered,
    piTemplateById: byId,
    piTemplate,
    // Experimental and intentionally removable until continuation quality is proven.
    enablePartialContinue: env.ENABLE_PARTIAL_CONTINUE !== "false",
  };
}

export function resolveTemplate(config, templateId) {
  const normalized = normalizeTemplateId(templateId);
  if (normalized && config.piTemplateById.has(normalized)) {
    return config.piTemplateById.get(normalized);
  }
  return null;
}
