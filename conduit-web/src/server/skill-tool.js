import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";

const result = (text, isError = false) => ({ content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });
const MAX_FILE = 64 * 1024;

/** A skill folder's files, relative, for the model to ask for by name (SKILL.md itself left out). */
async function filesOf(folder, at = "") {
  const out = [];
  for (const entry of await fs.readdir(path.join(folder, at), { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith(".")) continue;
    const relative = path.posix.join(at, entry.name);
    if (entry.isDirectory()) out.push(...await filesOf(folder, relative));
    else if (relative !== "SKILL.md") out.push(relative);
  }
  return out.slice(0, 100);
}

/**
 * `skill`: progressive disclosure for the skills a context document lists (context-store.js lists each as a line).
 * The body loads only when the model calls it, read on the hub, so a chat working on another device gets it too; a
 * file beside it (a reference, a script to read) loads by its relative path, and nothing outside the skill's folder.
 */
export const SkillTool = (runtime) => defineTool({
  name: "skill",
  description: "Load a skill: the instructions for a kind of work, listed under Skills in your instructions. Call it with the "
    + "skill's name before starting that kind of work, then follow it. With `file`, read a file the skill names.",
  parameters: Type.Object({
    name: Type.String({ description: "The skill's name, as listed." }),
    file: Type.Optional(Type.String({ description: "A file in the skill's folder, by the relative path the skill gives." })),
  }),
  replay: "safe",
  execute: async ({ name, file }) => {
    const skills = await runtime.skillsAvailable();
    const skill = skills.find((item) => item.name === name) || skills.find((item) => path.basename(item.folder) === name);
    if (!skill) return result(`No skill named ${name}. Skills: ${skills.map((item) => item.name).join(", ") || "none"}.`, true);
    if (file) {
      const target = path.resolve(skill.folder, file);
      if (!target.startsWith(path.resolve(skill.folder) + path.sep)) return result("That file is outside the skill's folder.", true);
      const text = await fs.readFile(target, "utf8").catch(() => null);
      if (text === null) return result(`${skill.name} has no file ${file}. Its files: ${(await filesOf(skill.folder)).join(", ") || "none"}.`, true);
      return result(text.length > MAX_FILE ? `${text.slice(0, MAX_FILE)}\n\n[cut at ${MAX_FILE} characters]` : text);
    }
    const body = skill.text.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
    const files = await filesOf(skill.folder);
    return result(files.length ? `${body}\n\n---\nFiles in this skill (read with skill and file): ${files.join(", ")}` : body);
  },
});
