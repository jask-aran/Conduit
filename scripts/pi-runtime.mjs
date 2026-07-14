import fs from "node:fs";
import path from "node:path";

function requireString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Pi experience requires ${name}`);
  return value.trim();
}

function requireStrings(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`Pi experience ${name} must be an array of paths`);
  }
  return value;
}

export function loadPiProfile(file) {
  const profileFile = path.resolve(file);
  const directory = path.dirname(profileFile);
  const profile = JSON.parse(fs.readFileSync(profileFile, "utf8"));
  const paths = (name) => requireStrings(profile[name], name).map((value) => path.resolve(directory, value));
  return {
    id: requireString(profile.id, "id"),
    version: requireString(profile.version, "version"),
    profileFile,
    systemPrompt: path.resolve(directory, profile.systemPrompt || "SYSTEM.md"),
    tools: requireStrings(profile.tools, "tools"),
    models: requireStrings(profile.models, "models"),
    extensions: paths("extensions"),
    skills: paths("skills"),
    promptTemplates: paths("promptTemplates"),
  };
}

export function buildPiResourceArgs(profile) {
  const args = [
    "--no-approve",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--system-prompt", profile.systemPrompt,
    "--tools", profile.tools.join(","),
  ];
  if (profile.models?.length) args.push("--models", profile.models.join(","));
  for (const extension of profile.extensions) args.push("--extension", extension);
  for (const skill of profile.skills) args.push("--skill", skill);
  for (const template of profile.promptTemplates) args.push("--prompt-template", template);
  return args;
}

export function buildPiEnvironment(agentDir, env = process.env) {
  const resolvedAgentDir = path.resolve(requireString(agentDir, "agent directory"));
  return {
    ...env,
    PI_CODING_AGENT_DIR: resolvedAgentDir,
    PI_CODING_AGENT_SESSION_DIR: path.join(resolvedAgentDir, "sessions"),
  };
}
