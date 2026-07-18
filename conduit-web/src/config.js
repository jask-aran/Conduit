import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listPiTemplates, loadPiTemplate } from "../../scripts/pi-runtime.mjs";
import { expandHome, parseAllowlist } from "./workspace-paths.js";
import { PiInstallationRegistry } from "./pi-installations.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function absolute(value) {
  return path.resolve(expandHome(value));
}

export function loadConfig(env = process.env) {
  const templatesRoot = absolute(env.CONDUIT_TEMPLATES_ROOT || path.join(repositoryRoot, "templates"));
  const defaultTemplateFile = env.CONDUIT_PI_TEMPLATE
    || path.join(templatesRoot, "chat", "template.json");
  const piTemplate = loadPiTemplate(defaultTemplateFile);
  const discovered = listPiTemplates(templatesRoot);
  const byId = new Map(discovered.map((template) => [template.id, template]));
  if (!byId.has(piTemplate.id)) {
    byId.set(piTemplate.id, piTemplate);
    discovered.push(piTemplate);
    discovered.sort((a, b) => a.id.localeCompare(b.id));
  }
  const dataRoot = path.join(repositoryRoot, "data");
  const filesRoot = absolute(env.CONDUIT_FILES_ROOT || path.join(repositoryRoot, "data/chat/files"));
  const workspaceAllowlist = parseAllowlist(env.CONDUIT_WORKSPACE_ALLOWLIST, {
    fallback: [os.homedir(), repositoryRoot, filesRoot],
  });
  const piAgentDir = absolute(env.CONDUIT_PI_AGENT_DIR || path.join(repositoryRoot, "data/pi"));
  const installations = new PiInstallationRegistry({
    conduitAgentDir: piAgentDir,
    conduitCommand: env.CONDUIT_PI_COMMAND || env.PI_COMMAND || "",
    nativeCommand: env.CONDUIT_NATIVE_PI_COMMAND || "",
  });
  return {
    host: env.CONDUIT_HOST || env.HOST || "127.0.0.1",
    port: Number(env.CONDUIT_PORT || env.PORT || 4310),
    piCommand: installations.get("conduit-pinned").command,
    repositoryRoot,
    dataRoot,
    filesRoot,
    catalogFile: absolute(env.CONDUIT_CATALOG_FILE || path.join(repositoryRoot, "data/conduit.json")),
    sessionRegistryFile: absolute(env.CONDUIT_SESSION_REGISTRY_FILE || path.join(repositoryRoot, "data/sessions.json")),
    preferencesFile: absolute(env.CONDUIT_PREFERENCES_FILE || path.join(dataRoot, "preferences.json")),
    piAgentDir,
    installations,
    defaultInstallationId: "conduit-pinned",
    bridgeSystemPrompt: path.join(templatesRoot, "conduit-workspace", "SYSTEM.md"),
    bridgeSkill: path.join(templatesRoot, "conduit-workspace", "SKILL.md"),
    runtimeSettingsFile: absolute(env.CONDUIT_RUNTIME_SETTINGS_FILE || path.join(dataRoot, "runtime.json")),
    templatesRoot,
    workspaceAllowlist,
    piTemplates: discovered,
    piTemplateById: byId,
    piTemplate,
    // Experimental and intentionally removable until continuation quality is proven.
    enablePartialContinue: env.ENABLE_PARTIAL_CONTINUE !== "false",
  };
}

export function resolveTemplate(config, templateId) {
  if (templateId && config.piTemplateById.has(templateId)) {
    return config.piTemplateById.get(templateId);
  }
  return null;
}
