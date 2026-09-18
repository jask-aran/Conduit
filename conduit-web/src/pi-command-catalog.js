import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

function resolveExtensionCommands(extensions) {
  const commands = extensions.flatMap((extension) => [...extension.commands.values()]);
  const counts = new Map();
  for (const command of commands) counts.set(command.name, (counts.get(command.name) || 0) + 1);
  const seen = new Map();
  const taken = new Set();
  return commands.map((command) => {
    const occurrence = (seen.get(command.name) || 0) + 1;
    seen.set(command.name, occurrence);
    let name = counts.get(command.name) > 1 ? `${command.name}:${occurrence}` : command.name;
    let suffix = occurrence;
    while (taken.has(name)) {
      suffix += 1;
      name = `${command.name}:${suffix}`;
    }
    taken.add(name);
    return { name, description: command.description, source: "extension" };
  });
}

export class PiCommandCatalog {
  constructor(agentDir) {
    this.agentDir = agentDir;
    this.cache = new Map();
  }

  list({ cwd, template }) {
    const key = JSON.stringify([cwd, template.id, template.version]);
    if (!this.cache.has(key)) {
      const request = this.#load({ cwd, template }).catch((error) => {
        this.cache.delete(key);
        throw error;
      });
      this.cache.set(key, request);
    }
    return this.cache.get(key);
  }

  async #load({ cwd, template }) {
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: this.agentDir,
      additionalExtensionPaths: template.extensions,
      additionalSkillPaths: template.skills,
      additionalPromptTemplatePaths: template.promptTemplates,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: template.systemPrompt,
    });
    await loader.reload();
    return [
      ...resolveExtensionCommands(loader.getExtensions().extensions),
      ...loader.getPrompts().prompts.map((prompt) => ({
        name: prompt.name,
        description: prompt.description,
        source: "prompt",
      })),
      ...loader.getSkills().skills.map((skill) => ({
        name: `skill:${skill.name}`,
        description: skill.description,
        source: "skill",
      })),
    ];
  }
}
