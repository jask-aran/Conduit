import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { defineTool, section } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";
import { AgentDoc, nextId } from "./agent-doc.js";
import { block, NOTES_FILE } from "./routines.js";
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

/** How many declined proposals the state doc keeps (`declined`), so a reflection does not propose them again. */
export const DECLINED_KEPT = 100;

export async function rejectProposal(agent, id) {
  return locked(`${agent.folder}:proposal:${id}`, () => agent.update((doc) => {
    const proposal = Object.hasOwn(doc.proposals, id) ? { ...doc.proposals[id] } : null;
    if (proposal) {
      delete doc.proposals[id];
      doc.declined = [...(doc.declined || []), { file: proposal.file, op: proposal.op, text: proposal.text, at: new Date().toISOString() }].slice(-DECLINED_KEPT);
    }
    return proposal;
  }));
}

/**
 * What a thread or run learned by inference, for the Reflection routine to promote or drop: one line appended to
 * NOTES.md, `- <date> | <origin> | <text>` with its provenance. Never edits another line; a replayed call adds nothing.
 */
async function note(agent, origin, text, attribution) {
  const root = await fs.realpath(agent.folder);
  const target = path.join(root, NOTES_FILE);
  return locked(target, async () => {
    try { if ((await fs.lstat(target)).isSymbolicLink()) throw new Error("NOTES.md must not be a link."); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    const call = token(attribution.callId);
    const content = await read(target);
    if (linesOf(content).some((line) => lineText(line).match(provenance)?.[3] === call)) return;
    const comment = `<!-- conduit by:${attribution.by} chat:${token(attribution.chatId || "-")} call:${call} at:${attribution.at} -->`;
    await fs.appendFile(target, `${content && !content.endsWith("\n") ? "\n" : ""}- ${agent.today(Date.parse(attribution.at))} | ${origin} | ${text} ${comment}\n`);
  });
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
export async function render(agent) {
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

const SCOPES = { soul: "Who it is: read in every turn", user: "About you: read in every turn", memory: "What it keeps: read in every turn" };
const BY = { home: "home thread", side: "a side thread", run: "a run", agent: "itself" };

/**
 * Every line of its memory as an entry, for the memory view: which file and section, what reads it (scope), and who
 * wrote it, from where, when (provenance; none for a line you or an editor wrote). Diary days back `days`.
 */
export async function memoryEntries(agent, { days = 14 } = {}) {
  const today = agent.today();
  const dates = [];
  const day = new Date(`${today}T00:00:00Z`);
  for (let i = 0; i < days; i++) { dates.push(day.toISOString().slice(0, 10)); day.setUTCDate(day.getUTCDate() - 1); }
  const sources = [...Object.keys(FILES).map((file) => ({ file, date: null })), ...dates.map((date) => ({ file: "diary", date }))];
  const read_ = await Promise.all(sources.map(async ({ file, date }) => read(await filePath(agent, file, date))));
  const entries = [];
  sources.forEach(({ file, date }, index) => {
    const content = file === "user" ? splitFrontMatter(read_[index]).body : read_[index];
    let section = null;
    for (const line of content.split(/\r?\n/)) {
      const heading = /^#{1,3}\s+(.+)$/.exec(line);
      if (heading) { section = heading[1].replace(provenance, "").trim(); continue; }
      // What is remembered is the list's items (every line the agent writes is one); a file's prose (its seed's own
      // explanation, a persona) is the file's, not a memory.
      if (!/^\s*[-*]\s+/.test(line)) continue;
      const text = line.replace(provenance, "").replace(/^\s*[-*]\s+/, "").trim();
      if (!text || /^<!--.*-->$/.test(text)) continue;
      const match = line.match(provenance);
      // The persona as seeded or written by you is who it is, not something it learned: only what it added shows.
      if (file === "soul" && !match) continue;
      entries.push({
        file, date, section, text, line,
        scope: file === "diary" ? (date === today ? "Today's diary: read in every turn" : "An earlier day: found when it searches") : SCOPES[file],
        provenance: match ? { by: match[1], from: BY[match[1]], chatId: match[2] === "-" ? null : match[2], callId: match[3], at: match[4], accepted: match[5] || null } : null,
      });
    }
  });
  return entries;
}

/** You forgetting one line, exactly as it stands (`line`): any line, yours or its own; none if it has changed since. */
export async function forgetLine(agent, file, date, line) {
  if (typeof line !== "string" || !line.trim()) throw Object.assign(new Error("Choose a line."), { status: 400 });
  const target = await filePath(agent, file, date);
  return locked(target, async () => {
    await filePath(agent, file, date);
    const lines = linesOf(await read(target));
    const matches = lines.map((item, index) => lineText(item) === line ? index : -1).filter((index) => index >= 0);
    if (matches.length !== 1) throw Object.assign(new Error(matches.length ? "Several lines match." : "That line has changed."), { status: 409 });
    lines.splice(matches[0], 1);
    await write(target, lines.join(""));
    return true;
  });
}

export function MemoryTools(runtime) {
  const memory = defineTool({
    name: "memory",
    description: "Read, add, remove or search the agent's memory files; note (text only) appends what you inferred, with its evidence, for the nightly reflection.",
    // Removal has no file receipt, so an interrupted call must not select a line again.
    replay: "unsafe",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("read"), Type.Literal("add"), Type.Literal("remove"), Type.Literal("search"), Type.Literal("note")]),
      file: Type.Optional(Type.Union([Type.Literal("soul"), Type.Literal("user"), Type.Literal("memory"), Type.Literal("diary")])),
      section: Type.Optional(Type.String({ description: "For add: the ## heading in the file to put the line under, e.g. People or Commitments." })),
      text: Type.Optional(Type.String()), query: Type.Optional(Type.String()), date: Type.Optional(Type.String()),
    }),
    execute: async (args, api, context) => {
      const agent = runtime.agent;
      if (!agent || !agent.enabled()) return result("The agent is not enabled.", true);
      try {
        if (args.action === "search") return result(await search(agent, args.query || ""));
        if (args.action === "note") {
          if (!args.text || !args.text.trim() || /[\r\n]|<!--|-->/.test(args.text)) return result("Provide one non-empty line of text.", true);
          if (args.text.trim().length > 500) return result("A note must be 500 characters or fewer.", true);
          const origin = await agent.describe(api.conversationId);
          const by = origin?.role || "agent";
          await note(agent, by === "side" ? `side:${origin.chatId}` : by, args.text.trim(), { by, chatId: origin?.chatId, callId: api.callId, at: new Date().toISOString() });
          return result("Noted for the reflection.");
        }
        const file = args.file;
        if (!file) return result("Choose a memory file.", true);
        const date = args.date === undefined ? agent.today() : args.date;
        if (file === "diary" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return result("Date must be YYYY-MM-DD.", true);
        if (args.action === "read") return result(compact(await read(await filePath(agent, file, date))));
        if (file === "soul") return result("Your soul belongs to the person: suggest the change to them instead.", true);
        if (!args.text || !args.text.trim() || /[\r\n]/.test(args.text)) return result("Provide one non-empty line of text.", true);
        const state = await agent.state();
        // Only the firing's live record grants home memory access; model-written files cannot grant it.
        const reflection = state.reflection?.conversationId === api.conversationId;
        const origin = reflection ? { role: "home", chatId: state.home?.chatId } : await agent.describe(api.conversationId);
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
