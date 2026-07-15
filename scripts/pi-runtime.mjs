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

export function loadPiTemplate(file) {
  const templateFile = path.resolve(file);
  const directory = path.dirname(templateFile);
  const template = JSON.parse(fs.readFileSync(templateFile, "utf8"));
  const paths = (name) => requireStrings(template[name], name).map((value) => path.resolve(directory, value));
  return {
    id: requireString(template.id, "id"),
    version: requireString(template.version, "version"),
    templateFile,
    systemPrompt: path.resolve(directory, template.systemPrompt || "SYSTEM.md"),
    tools: requireStrings(template.tools, "tools"),
    models: requireStrings(template.models, "models"),
    extensions: paths("extensions"),
    skills: paths("skills"),
    promptTemplates: paths("promptTemplates"),
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
