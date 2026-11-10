import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import { defineDoc, defineTool, wrapTool } from "@earendil-works/pi-durable";

const result = (text, isError = false) => ({ output: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });
const MAX_FILE = 64 * 1024;

/** Per conversation: the skills it loaded, and for each skill whose work it began, whether it had loaded it first. */
export const SkillUse = defineDoc({
  checkpointWhen: () => false, kind: "conduit.skills",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ loaded: {}, began: {} }),
});

/** A line of runtime/skill-use.jsonl (diagnostics read it): no content, names and whether the skill was loaded. */
const logUse = (runtime, record) => fs.appendFile(path.join(runtime.dataRoot, "runtime", "skill-use.jsonl"),
  `${JSON.stringify({ t: new Date().toISOString(), ...record })}\n`).catch(() => {});

/**
 * A skill's `nudge` (front matter): the calls that begin its kind of work. Each entry is a tool name, or `tool: text`
 * for a call of that tool whose arguments contain the text (`codemode: executor`, `routine: save`).
 */
function nudgeMatches(nudge, toolName, args) {
  if (!Array.isArray(nudge)) return false;
  let shown;
  return nudge.some((entry) => {
    if (typeof entry === "string") return entry === toolName;
    if (!entry || typeof entry !== "object") return false;
    const [[tool, text] = []] = Object.entries(entry);
    if (tool !== toolName || typeof text !== "string") return false;
    shown ??= JSON.stringify(args ?? null);
    return shown.includes(text);
  });
}

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

/** The committed head changes only when a compaction or reset reaches this conversation's context. */
async function position(runtime, api, context) {
  const conversation = await runtime.harness.conversation(api.conversationId, context);
  const view = await conversation.context(context);
  return { head: view.head?.id ?? null, tokens: estimateContextTokens(view.messages).tokens };
}
const recent = (loaded, at) => loaded && loaded.head === at.head && Number.isFinite(loaded.tokens)
  && at.tokens - loaded.tokens < 50_000;

async function skillText(skill) {
  const body = skill.text.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  const files = await filesOf(skill.folder);
  return files.length ? `${body}\n\n---\nFiles in this skill (read with skill and file): ${files.join(", ")}` : body;
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
  execute: async ({ name, file }, api, context) => {
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
    const text = await skillText(skill);
    if (api?.commit) {
      const at = await position(runtime, api, context);
      await api.commit(async (tx) => {
        const use = await tx.doc(SkillUse, api.conversationId);
        use.loaded[skill.name] = at;
      }, context);
      logUse(runtime, { conversationId: String(api.conversationId), skill: skill.name, event: "load" });
    }
    return result(text);
  },
});

/**
 * The nudge, as pi-durable wraps (an extension's `wraps`): the first call in a conversation that begins a skill's work
 * (its `nudge`) is recorded with whether the skill was loaded first, and when it was not, the call's result ends with
 * a line saying which skill covers it. Auto skills put their body before the result until it is loaded recently.
 */
export function skillNudges(runtime, toolNames) {
  return toolNames.map((name) => wrapTool({ name }, (tool) => ({ ...tool, execute: async (args, api, context) => {
    const outcome = await tool.execute(args, api, context);
    try {
      const seen = (runtime.skillsBegun ||= new Map()).get(String(api?.conversationId)) || new Set();
      const covering = (await runtime.skillsAvailable()).filter((skill) => (skill.load === "auto" || !seen.has(skill.name)) && nudgeMatches(skill.nudge, tool.name, args));
      if (!covering.length || !api?.commit) return outcome;
      const began = [];
      const injected = [];
      const at = covering.some((skill) => skill.load === "auto") ? await position(runtime, api, context) : null;
      const bodies = new Map(await Promise.all(covering.filter((skill) => skill.load === "auto")
        .map(async (skill) => [skill.name, await skillText(skill)])));
      await api.commit(async (tx) => {
        const use = await tx.doc(SkillUse, api.conversationId);
        for (const skill of covering) {
          if (!use.began[skill.name]) {
            use.began[skill.name] = use.loaded[skill.name] ? "loaded" : "not loaded";
            began.push({ name: skill.name, loaded: Boolean(use.loaded[skill.name]), auto: skill.load === "auto" });
          }
          if (skill.load === "auto" && outcome && Array.isArray(outcome.output) && !recent(use.loaded[skill.name], at)) {
            use.loaded[skill.name] = at;
            injected.push({ type: "text", text: `[The ${skill.name} skill, loaded for this call]\n${bodies.get(skill.name)}` });
          }
        }
      }, context);
      for (const skill of covering) seen.add(skill.name);
      runtime.skillsBegun.set(String(api.conversationId), seen);
      for (const item of began) logUse(runtime, { conversationId: String(api.conversationId), skill: item.name, event: "began", tool: tool.name, loaded: item.loaded });
      for (const skill of covering) if (injected.some((item) => item.text.startsWith(`[The ${skill.name} skill,`))) {
        logUse(runtime, { conversationId: String(api.conversationId), skill: skill.name, event: "auto", tool: tool.name });
      }
      const missing = began.filter((item) => !item.loaded && !item.auto).map((item) => item.name);
      if (!outcome || !Array.isArray(outcome.output)) return outcome;
      const output = [...injected, ...outcome.output];
      if (!missing.length) return injected.length ? { ...outcome, output } : outcome;
      const note = `[The ${missing.join(" and ")} skill${missing.length > 1 ? "s cover" : " covers"} this kind of work: load ${missing.length > 1 ? "them" : "it"} with skill before going further.]`;
      return { ...outcome, output: [...output, { type: "text", text: note }] };
    } catch { return outcome; }
  } })));
}
