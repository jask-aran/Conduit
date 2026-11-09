/*
 * A turn's digest: what jbot did, in the person's terms rather than its tools' ("checked Gmail and searched the web"),
 * built from the steps the trace already holds -- each tool's facts (the hub names a connector call's services), a
 * script's calls, a spawn's agent, the path of a file in jbot's own folder.
 *
 * 1. Each step is an act on an object (`Act`), or nothing: plumbing (finding a connector's tool, reading a guide,
 *    the reply itself sent with `message`) is how it worked, not what it did.
 * 2. Acts on one object are one, counted where they count (commands, pages, agents); ranked by how far they reached
 *    into the person's world: what it sent, changed or asked; their accounts; the web; this machine.
 * 3. Said settled as the top two and how many more ("checked Gmail and searched the web, and 1 more"); live, the act
 *    under way in its present tense ("checking Gmail"), so the live line and the settled one use the same words.
 */
import type { ToolCallStep, ToolItem, ToolKind } from "../api/contracts";
import type { TurnTraceData } from "../turn-rows";
import { spawned } from "./agents";
import { scriptCalls, stepKind, toolName } from "./tool-card";

type Step = (ToolItem | ToolCallStep) & { input?: unknown };
/** An act: its verb (doing, done), what it acted on (one; `many` the plural when it counts), how far it reached. */
export type Act = { verb: [string, string]; object: string; many?: string; rank: number; failed?: boolean };

/** What a file of jbot's own folder is to the person, by its path. */
function ownFile(path: string): string | null {
  const name = path.replace(/\\/g, "/");
  if (/(^|\/)memory(\.md|\/)/.test(name)) return "its memory";
  if (/(^|\/)diary\//.test(name)) return "its diary";
  if (/(^|\/)routines\//.test(name)) return "a routine";
  if (/(^|\/)inbox\//.test(name)) return "its inbox";
  if (/(^|\/)user\.md$/.test(name)) return "what it knows about you";
  return null;
}
const host = (subject: string) => { try { return new URL(subject).hostname.replace(/^www\./, ""); } catch { return null; } };
const PLUMBING = /(^| )actions$|^action details$|'s guide$/;
const OWN_TOOLS: Record<string, string> = { memory: "its memory", chats: "your chats", schedule: "its schedules", watch: "its watches" };

/** One step as an act, or null for plumbing. */
/* A tool by its name, for the moment before it is classified (its kind arrives with its facts). */
const NAME_KINDS: Record<string, ToolKind> = { bash: "command", web_search: "search", fetch_content: "fetch", get_search_content: "read", source_check: "fetch" };
function actOf(step: Step, failed: boolean): Act | null {
  const known = stepKind(step), facts = step.facts, subject = step.subject || "";
  const kind = known === "other" ? NAME_KINDS[step.name || ""] ?? known : known;
  if (step.name === "get_search_content") return failed ? null : { verb: ["reading", "read"], object: "what it found", rank: 3 };
  const with_ = (act: Act): Act => failed ? { ...act, failed } : act;
  const name = step.name || "";
  if (name === "skill" || name === "nothing_to_report" || name === "run_failed") return null;
  // jbot's own: carrying out what the person allowed, its inbox, its routines and feeds, the chats it starts.
  if (name === "approved" || /^mcp__executor__resume$/.test(name)) return with_({ verb: ["carrying out", "carried out"], object: "what you approved", rank: 1 });
  if (/(^|_)inbox$/.test(name)) {
    const action = String(((step.input ?? {}) as { action?: string }).action || "");
    return with_(/^(handle|dismiss|address|reopen)$/.test(action) ? { verb: ["sorting", "sorted"], object: "its inbox", rank: 2 }
      : action === "add" ? { verb: ["noting", "noted"], object: "something for later", rank: 2 } : { verb: ["checking", "checked"], object: "its inbox", rank: 3 });
  }
  if (name === "routine") return with_({ verb: ["changing", "changed"], object: "a routine", many: "routines", rank: 2 });
  if (name === "feed") return with_({ verb: ["checking", "checked"], object: "its feeds", rank: 3 });
  if (name === "start_chat") return with_({ verb: ["starting", "started"], object: "a chat", many: "chats", rank: 1 });
  if (name === "steer_chat") return with_({ verb: ["steering", "steered"], object: "a chat", many: "chats", rank: 1 });
  if (step.name === "message") {
    const input = (step.input ?? {}) as { notify?: string; room?: string };
    if (input.room && input.room !== "app") return with_({ verb: ["emailing", "emailed"], object: "you", rank: 1 });
    if (input.notify === "push" || input.notify === "urgent") return with_({ verb: ["notifying", "notified"], object: "your phone", rank: 1 });
    return null;
  }
  // A spawn: a background agent is sent off, a turn's own is waited on.
  if (kind === "agent") {
    const tool = step as ToolItem;
    if (!("toolCallId" in step) || !spawned(tool)) return null;
    return tool.agent?.id?.startsWith("fg-") ? with_({ verb: ["waiting on", "asked"], object: "an agent", many: "agents", rank: 2 })
      : with_({ verb: ["starting", "started"], object: "an agent", many: "agents", rank: 1 });
  }
  // A connector's call, as the hub said it: its own tools are plumbing; a service it reached is the object.
  if (facts?.verb && /^mcp__/.test(step.name || "")) {
    if (PLUMBING.test(facts.subject || "")) return null;
    const services = facts.subject || toolName(step.name) || "a connector";
    if (failed) return { verb: ["trying to reach", "couldn't reach"], object: services, rank: 2, failed };
    if (facts.verb[1] === "Requested") return { verb: kind === "message" ? ["asking to send with", "asked to send with"] : ["asking to change", "asked to change"], object: services, rank: 1 };
    if (facts.verb[1] === "Ran") return { verb: ["running", "ran"], object: "a program", many: "programs", rank: 4 };
    return { verb: ["checking", "checked"], object: services, rank: 2 };
  }
  if (OWN_TOOLS[step.name || ""]) return with_({ verb: kind === "edit" ? ["changing", "changed"] : ["checking", "checked"], object: OWN_TOOLS[step.name!]!, rank: kind === "edit" ? 2 : 4 });
  switch (kind) {
    case "search": return with_({ verb: ["searching", "searched"], object: "the web", rank: 3 });
    case "fetch": { const site = host(subject); return with_({ verb: ["reading", "read"], object: site ? `a page on ${site}` : "a page", many: "pages", rank: 3 }); }
    case "edit": { const own = ownFile(subject); return with_(own ? { verb: ["updating", "updated"], object: own, rank: 2 } : { verb: ["editing", "edited"], object: "a file", many: "files", rank: 2 }); }
    case "read": { const own = ownFile(subject); return with_(own ? { verb: ["reading", "read"], object: own, rank: 4 } : { verb: ["reading", "read"], object: "a file", many: "files", rank: 4 }); }
    case "command": return with_({ verb: ["running", "ran"], object: "a command", many: "commands", rank: 4 });
    case "message": return with_({ verb: ["messaging", "messaged"], object: "you", rank: 1 });
    case "script": return null;
    default: {
      const named = (toolName(step.name) || "").replace(/_/g, " ");
      return named ? with_({ verb: ["using", "used"], object: named, rank: 4 }) : null;
    }
  }
}

/** A tool and, for a script, the calls it made (a script is what it called). */
function stepsOf(tool: ToolItem): { step: Step; failed: boolean; running: boolean }[] {
  const calls = tool.kind === "script" ? scriptCalls(tool) : [];
  if (calls.length) return calls.map((call) => ({ step: call, failed: Boolean(call.isError), running: call.done === false }));
  return [{ step: tool, failed: Boolean(tool.isError), running: !tool.done }];
}

/** The turn's acts, one per verb and object, counted, most far-reaching first (then in the order they happened). */
export function digestActs(trace: TurnTraceData): (Act & { count: number })[] {
  const acts = new Map<string, Act & { count: number; at: number }>();
  let at = 0;
  for (const segment of trace.segments) {
    if (segment.kind !== "tool" || !segment.tool.name || segment.tool.name === "tool") continue;
    for (const { step, failed } of stepsOf(segment.tool)) {
      const act = actOf(step, failed);
      if (!act) continue;
      // Pages on different sites are one act, "read 3 pages", once there is more than one.
      const key = `${act.verb[1]}|${act.many ? act.many : act.object}`;
      const was = acts.get(key);
      if (was) { was.count += 1; if (was.object !== act.object) was.object = act.many ? `a ${act.many.replace(/s$/, "")}` : was.object; }
      else acts.set(key, { ...act, count: 1, at: at++ });
    }
  }
  // A service that failed and then answered was reached: the failure is not what it did.
  for (const [key, act] of acts) if (act.failed && [...acts.values()].some((other) => !other.failed && other.object === act.object)) acts.delete(key);
  return [...acts.values()].sort((left, right) => left.rank - right.rank || left.at - right.at);
}

const said = (act: Act & { count: number }) => {
  const object = act.count > 1 && act.many ? `${act.count} ${act.many}` : act.object;
  return `${act.verb[1]} ${object}`;
};
/** Settled: "checked Gmail and searched the web", "…, and 2 more"; "" when it did nothing to tell. */
export function digestDone(trace: TurnTraceData): string {
  const acts = digestActs(trace);
  if (!acts.length) return "";
  const [first, second] = acts;
  const more = acts.length - 2;
  return second ? `${said(first!)} and ${said(second)}${more > 0 ? `, and ${more} more` : ""}` : said(first!);
}

/** Live: the act under way, present tense ("checking Gmail"); plumbing under way is finding its tool; null between
 *  steps (thinking, writing: the caller's). */
export function digestDoing(trace: TurnTraceData): string | null {
  const running = trace.segments.flatMap((segment) => segment.kind === "tool" && !segment.tool.done ? [segment.tool] : []);
  const tool = running[0];
  if (!tool) return null;
  if (!tool.name || tool.name === "tool") return "using its tools";
  const steps = stepsOf(tool);
  const now = steps.find((step) => step.running) ?? steps.at(-1)!;
  const act = actOf(now.step, false);
  if (act) return `${act.verb[0]} ${act.object}`;
  return /^mcp__/.test(now.step.name || "") ? "finding the right tool" : now.step.name === "skill" ? "reading a guide" : "using its tools";
}
