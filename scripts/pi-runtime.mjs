import fs from "node:fs";
import path from "node:path";

function requireString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Pi template requires ${name}`);
  return value.trim();
}

function requireStrings(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`Pi template ${name} must be an array of paths`);
  }
  return value;
}

function formatPosture(tools = []) {
  const labels = tools.map((tool) => {
    if (tool === "bash") return "shell";
    return tool;
  });
  return labels.join(" / ");
}

export function loadPiTemplate(file) {
  const templateFile = path.resolve(file);
  const directory = path.dirname(templateFile);
  const template = JSON.parse(fs.readFileSync(templateFile, "utf8"));
  const paths = (name) => requireStrings(template[name], name).map((value) => path.resolve(directory, value));
  const tools = requireStrings(template.tools, "tools");
  return {
    id: requireString(template.id, "id"),
    version: requireString(template.version, "version"),
    label: typeof template.label === "string" && template.label.trim() ? template.label.trim() : requireString(template.id, "id"),
    description: typeof template.description === "string" ? template.description.trim() : "",
    posture: typeof template.posture === "string" && template.posture.trim()
      ? template.posture.trim()
      : formatPosture(tools),
    templateFile,
    systemPrompt: path.resolve(directory, template.systemPrompt || "SYSTEM.md"),
    tools,
    models: requireStrings(template.models, "models"),
    extensions: paths("extensions"),
    skills: paths("skills"),
    promptTemplates: paths("promptTemplates"),
  };
}

export function listPiTemplates(templatesRoot) {
  const root = path.resolve(templatesRoot);
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const templates = [];
  const seen = new Map();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(root, entry.name, "template.json");
    if (!fs.existsSync(file)) continue;
    const template = loadPiTemplate(file);
    if (seen.has(template.id)) {
      throw new Error(
        `Duplicate Pi template id "${template.id}" in ${seen.get(template.id)} and ${template.templateFile}`,
      );
    }
    seen.set(template.id, template.templateFile);
    templates.push(template);
  }
  return templates.sort((a, b) => a.id.localeCompare(b.id));
}

export function templatePublicView(template) {
  if (!template) return null;
  return {
    id: template.id,
    version: template.version,
    label: template.label || template.id,
    description: template.description || "",
    posture: template.posture || formatPosture(template.tools),
    tools: [...(template.tools || [])],
    models: [...(template.models || [])],
    extensionCount: (template.extensions || []).length,
    skillCount: (template.skills || []).length,
    promptTemplateCount: (template.promptTemplates || []).length,
  };
}

export function buildPiResourceArgs(template) {
  const args = [
    "--no-approve",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--system-prompt", template.systemPrompt,
    "--tools", template.tools.join(","),
  ];
  if (template.models?.length) args.push("--models", template.models.join(","));
  for (const extension of template.extensions) args.push("--extension", extension);
  for (const skill of template.skills) args.push("--skill", skill);
  for (const promptTemplate of template.promptTemplates) args.push("--prompt-template", promptTemplate);
  return args;
}

export function loadPiModelPatterns(agentDir, fallbackModels = []) {
  const settingsFile = path.join(path.resolve(agentDir), "settings.json");
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    return Array.isArray(settings.enabledModels) ? settings.enabledModels : fallbackModels;
  } catch (error) {
    if (error.code === "ENOENT") return fallbackModels;
    throw error;
  }
}

export function buildPiEnvironment(agentDir, env = process.env) {
  const resolvedAgentDir = path.resolve(requireString(agentDir, "agent directory"));
  const { PI_CODING_AGENT_SESSION_DIR: _sessionDir, ...runtimeEnv } = env;
  return {
    ...runtimeEnv,
    PI_CODING_AGENT_DIR: resolvedAgentDir,
  };
}
