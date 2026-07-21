import fs from "node:fs/promises";
import path from "node:path";
import { loadSkills, parseFrontmatter } from "@earendil-works/pi-coding-agent";

const SOURCES = new Set(["extension", "prompt", "skill"]);

function commandName(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^\/+/, "").trim();
}

function publicCommand(command) {
  if (!command || typeof command !== "object" || !SOURCES.has(command.source)) return null;
  const name = commandName(command.name);
  if (!name) return null;
  return {
    name,
    description: typeof command.description === "string" ? command.description.trim() : "",
    source: command.source,
    dispatch: command.source === "prompt" ? "insert" : "prompt",
  };
}

function firstWins(commands) {
  const seen = new Set();
  const result = [];
  for (const command of commands) {
    const normalized = publicCommand(command);
    if (!normalized || seen.has(normalized.name)) continue;
    seen.add(normalized.name);
    result.push(normalized);
  }
  return result;
}

function resourcePaths(value, templateDir) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "string" || !item.trim()) return [];
    return [path.resolve(templateDir, item.trim())];
  });
}

function templateDirectory(templateDir, manifest) {
  if (typeof templateDir === "string" && templateDir.trim()) return path.resolve(templateDir);
  if (typeof manifest?.templateFile === "string" && manifest.templateFile.trim()) {
    return path.dirname(path.resolve(manifest.templateFile));
  }
  return process.cwd();
}

export function normalizeRpcCommands(commands) {
  return firstWins(Array.isArray(commands) ? commands : []);
}

async function promptCommand(file) {
  try {
    const content = await fs.readFile(file, "utf8");
    const parsed = parseFrontmatter(content);
    const frontmatter = parsed.frontmatter && typeof parsed.frontmatter === "object"
      ? parsed.frontmatter
      : {};
    let description = typeof frontmatter.description === "string"
      ? frontmatter.description.trim()
      : "";
    if (!description) {
      const firstLine = parsed.body.split("\n").find((line) => line.trim());
      if (firstLine) {
        description = firstLine.trim().slice(0, 60);
        if (firstLine.trim().length > 60) description += "...";
      }
    }
    return publicCommand({
      name: path.basename(file).replace(/\.md$/, ""),
      description,
      source: "prompt",
    });
  } catch {
    return null;
  }
}

async function promptCommandsFromPath(resourcePath) {
  try {
    const stats = await fs.stat(resourcePath);
    if (stats.isFile()) {
      if (!resourcePath.endsWith(".md")) return [];
      const command = await promptCommand(resourcePath);
      return command ? [command] : [];
    }
    if (!stats.isDirectory()) return [];
    const entries = await fs.readdir(resourcePath, { withFileTypes: true });
    const commands = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.name.endsWith(".md")) continue;
      const file = path.join(resourcePath, entry.name);
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try { isFile = (await fs.stat(file)).isFile(); } catch { isFile = false; }
      }
      if (!isFile) continue;
      const command = await promptCommand(file);
      if (command) commands.push(command);
    }
    return commands;
  } catch {
    return [];
  }
}

async function discoverPromptCommands(manifest, directory) {
  const commands = [];
  for (const resourcePath of resourcePaths(manifest?.promptTemplates, directory)) {
    commands.push(...await promptCommandsFromPath(resourcePath));
  }
  return commands;
}

function discoverSkillCommands(manifest, directory) {
  const skillPaths = resourcePaths(manifest?.skills, directory);
  if (!skillPaths.length) return [];
  try {
    const result = loadSkills({
      agentDir: directory,
      cwd: directory,
      skillPaths,
      includeDefaults: false,
    });
    return result.skills.map((skill) => publicCommand({
      name: `skill:${skill.name}`,
      description: skill.description,
      source: "skill",
    })).filter(Boolean);
  } catch {
    return [];
  }
}

async function extensionCommandMetadata(manifest, directory) {
  if (Object.prototype.hasOwnProperty.call(manifest || {}, "extensionCommands")) {
    return Array.isArray(manifest.extensionCommands) ? manifest.extensionCommands : [];
  }
  try {
    const rawManifest = JSON.parse(await fs.readFile(path.join(directory, "template.json"), "utf8"));
    return Array.isArray(rawManifest.extensionCommands) ? rawManifest.extensionCommands : [];
  } catch {
    return [];
  }
}

async function discoverExtensionCommands(manifest, directory) {
  const metadata = await extensionCommandMetadata(manifest, directory);
  return metadata.map((command) => publicCommand({
    name: command?.name,
    description: command?.description,
    source: "extension",
  })).filter(Boolean);
}

export async function discoverTemplateCommands({ templateDir, manifest } = {}) {
  const directory = templateDirectory(templateDir, manifest);
  const prompts = await discoverPromptCommands(manifest, directory);
  const skills = discoverSkillCommands(manifest, directory);
  const extensions = await discoverExtensionCommands(manifest, directory);
  return firstWins([...prompts, ...skills, ...extensions]);
}

export async function resolvePiCommandCatalog({
  rpcCommands,
  templateDir,
  manifest,
  hostMode = false,
} = {}) {
  if (Array.isArray(rpcCommands)) return normalizeRpcCommands(rpcCommands);
  if (hostMode) return [];
  return discoverTemplateCommands({ templateDir, manifest });
}
