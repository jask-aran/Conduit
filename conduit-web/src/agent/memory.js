import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { defineTool, section } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";
import { AgentDoc, nextId } from "./agent-doc.js";
import { block } from "./routines.js";
import { splitFrontMatter } from "./routine-files.js";

const FILES = { soul: "SOUL.md", user: "USER.md", memory: "MEMORY.md" };

/** The persona was IDENTITY.md until it took the name the products use (SOUL.md); an agent made before moves on. */
export async function migrateSoul(folder) {
  if (!folder) return;
  const from = path.join(folder, "IDENTITY.md");
  const to = path.join(folder, "SOUL.md");
  if (await fs.stat(to).catch(() => null)) return;
  await fs.rename(from, to).catch((error) => { if (error.code !== "ENOENT") throw error; });
}

/** Where an added line goes: under `## section` (made at the end if missing), after its last line; else the end. */
function addUnder(content, section, text) {
  if (!section) return `${content}${text}\n`;
  const lines = linesOf(content);
  const heading = lines.findIndex((line) => lineText(line).replace(/^##\s+/, "").trim().toLowerCase() === section.trim().toLowerCase() && /^##\s/.test(line));
  if (heading < 0) return `${content}${content.endsWith("\n\n") || !content ? "" : "\n"}## ${section.trim()}\n${text}\n`;
  let end = heading + 1;
  while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end++;
  // After the section's last line with text, so a blank line before the next heading stays.
  let at = end;
  while (at > heading + 1 && !lineText(lines[at - 1]).trim()) at--;
  lines.splice(at, 0, `${text}\n`);
  return lines.join("");
}
const locks = new Map();
const provenance = / <!-- conduit by:(home|side|run|agent) chat:([^\s]+) call:([^\s]+) at:(\d{4}-\d\d-\d\dT[^\s]+)(?: accepted:(\d{4}-\d\d-\d\d))? -->$/;
const result = (text, isError = false) => ({ output: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });
const compact = (text) => text.replace(/ <!-- conduit by:(?:home|side|run|agent) chat:[^\s]+ call:[^\s]+ at:(\d{4}-\d\d-\d\d)T[^\s]+(?: accepted:\d{4}-\d\d-\d\d)? -->$/gm, " (noted $1)");
const linesOf = (text) => text.match(/[^\n]*(?:\n|$)/g).filter(Boolean);
const lineText = (line) => line.replace(/\r?\n$/, "");
const token = (value) => {
  if (typeof value !== "string" || !value || /[\s<>]/.test(value)) throw new Error("Invalid memory provenance.");
  return value;
};

/** Keep file edits in call order, including proposal decisions. */
async function locked(key, fn) {
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(fn);
  locks.set(key, current);
  try { return await current; } finally { if (locks.get(key) === current) locks.delete(key); }
}

async function filePath(agent, file, date, create = false) {
  if (file === "diary" && !/^\d{4}-\d{2}-\d{2}$/.test(date || "")) throw new Error("Date must be YYYY-MM-DD.");
  if (file !== "diary" && !Object.hasOwn(FILES, file)) throw new Error("Choose a memory file.");
  const root = await fs.realpath(agent.folder);
  let dir = root;
  if (file === "diary") {
    dir = path.join(root, "diary");
    if (create) await fs.mkdir(dir, { recursive: true });
    try {
      if ((await fs.realpath(dir)) !== dir) throw new Error("Diary folder must not be a link.");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const target = path.join(dir, file === "diary" ? `${date}.md` : FILES[file]);
  try { if ((await fs.lstat(target)).isSymbolicLink()) throw new Error("Memory file must not be a link."); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  return target;
}

async function read(target) {
  try { return await fs.readFile(target, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}

async function write(target, text) {
  const temp = path.join(path.dirname(target), `.conduit-${randomUUID()}.tmp`);
  try { await fs.writeFile(temp, text, { flag: "wx" }); await fs.rename(temp, target); }
  finally { await fs.unlink(temp).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
}

function matchingLine(content, text) {
  const lines = linesOf(content);
  const visible = lines.map((line) => lineText(line).replace(provenance, ""));
  let matches = visible.map((line, index) => line === text ? index : -1).filter((index) => index >= 0);
  if (!matches.length) matches = visible.map((line, index) => line.includes(text) ? index : -1).filter((index) => index >= 0);
  if (!matches.length) throw new Error("No matching line.");
  if (matches.length > 1) throw new Error("Several lines match.");
  const index = matches[0];
  if (!provenance.test(lineText(lines[index]))) throw new Error("The person's line cannot be removed.");
  return lineText(lines[index]);
}

async function edit(agent, file, date, op, text, attribution) {
  const target = await filePath(agent, file, date, op === "add");
  return locked(target, async () => {
    await filePath(agent, file, date);
    let content = await read(target);
    if (op === "remove") {
      const targetLine = attribution.targetLine ?? matchingLine(content, text);
      if (!provenance.test(targetLine)) throw new Error("The person's line cannot be removed.");
      const lines = linesOf(content);
      const matches = lines.map((line, index) => lineText(line) === targetLine ? index : -1).filter((index) => index >= 0);
      if (!matches.length) return;
      if (matches.length > 1) throw new Error("Several lines match.");
      lines.splice(matches[0], 1);
      content = lines.join("");
    }
    else {
      const call = token(attribution.callId);
      if (linesOf(content).some((line) => { const match = lineText(line).match(provenance); return match && match[3] === call; })) return;
      const accepted = attribution.accepted ? ` accepted:${attribution.accepted}` : "";
      const comment = `<!-- conduit by:${attribution.by} chat:${token(attribution.chatId || "-")} call:${call} at:${attribution.at}${accepted} -->`;
      if (file === "diary" && !content) content = `# ${date} ${comment}\n`;
      if (content && !content.endsWith("\n")) content += "\n";
      const time = file === "diary" ? `${new Intl.DateTimeFormat("en-GB", { timeZone: agent.settings().timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(attribution.at))} ` : "";
      content = addUnder(content, file === "diary" ? null : attribution.section, `- ${time}${text} ${comment}`);
    }
    await write(target, content);
  });
}

export async function listProposals(agent) {
  return Object.values((await agent.state()).proposals).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

export async function acceptProposal(agent, id) {
  return locked(`${agent.folder}:proposal:${id}`, async () => {
    const proposals = (await agent.state()).proposals;
    if (!Object.hasOwn(proposals, id)) return null;
    const proposal = { ...proposals[id] };
    if (proposal.op === "remove" && proposal.targetLine === undefined) {
      const target = await filePath(agent, proposal.file);
      // Save the exact line before deletion so a retry cannot select a new match.
      proposal.targetLine = await locked(target, async () => {
        await filePath(agent, proposal.file);
        return matchingLine(await read(target), proposal.text);
      });
      await agent.update((doc) => { doc.proposals[id].targetLine = proposal.targetLine; });
    }
    await edit(agent, proposal.file, null, proposal.op, proposal.text, { ...proposal, by: "run", accepted: agent.today() });
    await agent.update((doc) => { delete doc.proposals[id]; });
    return proposal;
  });
}

export async function rejectProposal(agent, id) {
  return locked(`${agent.folder}:proposal:${id}`, () => agent.update((doc) => {
    const proposal = Object.hasOwn(doc.proposals, id) ? { ...doc.proposals[id] } : null;
    if (proposal) delete doc.proposals[id];
    return proposal;
  }));
}

async function search(agent, query) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) throw new Error("Provide a search query.");
  const found = [];
  const scan = async (file, date) => {
    const content = await read(await filePath(agent, file, date));
    for (const line of content.split(/\r?\n/)) {
      const lower = line.replace(provenance, "").toLowerCase();
      if (line && words.every((word) => lower.includes(word))) found.push(`${file}${date ? ` ${date}` : ""}: ${compact(line)}`);
      if (found.length >= 40) break;
    }
  };
  for (const file of ["user", "memory"]) { await scan(file); if (found.length >= 40) return found.join("\n"); }
  const today = agent.today();
  const day = new Date(`${today}T00:00:00Z`);
  for (let i = 0; i < 60 && found.length < 40; i++) {
    await scan("diary", day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() - 1);
  }
  return found.join("\n") || "No matches.";
}

/** jbot's files as tagged blocks (routines.js `block`), each turn; USER.md without its front matter (the fields). */
async function render(agent) {
  const today = agent.today();
  const [soul, user, memory, diary] = await Promise.all(["soul", "user", "memory", "diary"].map(async (file) => read(await filePath(agent, file, today))));
  const diaryLines = linesOf(diary);
  const memoryLines = linesOf(memory);
  const build = () => [block("soul", {}, compact(soul)), block("user", {}, compact(splitFrontMatter(user).body)),
    block("memory", {}, compact(memoryLines.join(""))), block("diary", { day: today }, compact(diaryLines.join("")))].join("\n\n");
  let output = build();
  for (const lines of [diaryLines, memoryLines]) {
    for (let i = 0; output.length > 16000 && i < lines.length;) {
      if (provenance.test(lineText(lines[i]))) { lines.splice(i, 1); output = build(); }
      else i++;
    }
  }
  return output;
}

export function MemoryTools(runtime) {
  const memory = defineTool({
    name: "memory",
    description: "Read, add, remove or search the agent's memory files.",
    // Removal has no file receipt, so an interrupted call must not select a line again.
    replay: "unsafe",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("read"), Type.Literal("add"), Type.Literal("remove"), Type.Literal("search")]),
      file: Type.Optional(Type.Union([Type.Literal("soul"), Type.Literal("user"), Type.Literal("memory"), Type.Literal("diary")])),
      section: Type.Optional(Type.String({ description: "For add: the ## heading in the file to put the line under, e.g. People or Commitments." })),
      text: Type.Optional(Type.String()), query: Type.Optional(Type.String()), date: Type.Optional(Type.String()),
    }),
    execute: async (args, api, context) => {
      const agent = runtime.agent;
      if (!agent || !agent.enabled()) return result("The agent is not enabled.", true);
      try {
        if (args.action === "search") return result(await search(agent, args.query || ""));
        const file = args.file;
        if (!file) return result("Choose a memory file.", true);
        const date = args.date === undefined ? agent.today() : args.date;
        if (file === "diary" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return result("Date must be YYYY-MM-DD.", true);
        if (args.action === "read") return result(compact(await read(await filePath(agent, file, date))));
        if (file === "soul") return result("Your soul belongs to the person: suggest the change to them instead.", true);
        if (!args.text || !args.text.trim() || /[\r\n]/.test(args.text)) return result("Provide one non-empty line of text.", true);
        const origin = await agent.describe(api.conversationId);
        const by = origin?.role || "agent";
        const at = new Date().toISOString();
        if (by === "run" && file !== "diary") {
          await api.commit(async (tx) => {
            const doc = await tx.doc(AgentDoc);
            if (Object.values(doc.proposals).some((proposal) => proposal.callId === api.callId && proposal.conversationId === api.conversationId)) return;
            const id = nextId(doc, "p");
            doc.proposals[id] = { id, file, op: args.action, text: args.text, ...(args.section ? { section: args.section } : {}), by, chatId: origin?.chatId || null, conversationId: api.conversationId, callId: api.callId, at };
          }, context);
          return result("Proposed; the person will accept or reject it.");
        }
        await edit(agent, file, date, args.action, args.text, { by, chatId: origin?.chatId, callId: api.callId, at, section: args.section });
        return result(args.action === "add" ? "Added." : "Removed.");
      } catch (error) { return result(error.message || "Memory operation failed.", true); }
    },
  });
  // jbot's threads only: a run gets RUN.md and what its routine opts into (routines.js), not the person's files.
  return { tools: [memory], sections: [section("agent-memory", async (input) => {
    const agent = runtime.agent;
    if (!agent?.enabled() || (await agent.describe(input.conversationId))?.role === "run") return undefined;
    return render(agent);
  }, { tag: false })] };
}
