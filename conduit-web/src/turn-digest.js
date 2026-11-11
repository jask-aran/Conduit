/*
 * Plumbing (finding a connector's tool, reading a guide, the reply itself) is how a turn worked, not what it did, so
 * it is no act. Acts rank by how far they reached into the person's world: what was sent, changed or asked; their
 * accounts; the web; this machine. The live line and the settled one share their words.
 */

const ownFile = (path) => {
  const name = String(path).replace(/\\/g, "/");
  if (/(^|\/)memory(\.md|\/)/.test(name)) return "its memory";
  if (/(^|\/)diary\//.test(name)) return "its diary";
  if (/(^|\/)routines\//.test(name)) return "a routine";
  if (/(^|\/)inbox\//.test(name)) return "its inbox";
  if (/(^|\/)user\.md$/.test(name)) return "what it knows about you";
  return null;
};
const host = (subject) => { try { return new URL(subject).hostname.replace(/^www\./, ""); } catch { return null; } };
const toolName = (name) => String(name || "").replace(/mcp__([A-Za-z0-9]+(?:_[A-Za-z0-9]+)*)__([\w.-]+)/g, (_, service, tool) => `${service[0].toUpperCase()}${service.slice(1)} ${tool}`);
const PLUMBING = /(^| )actions$|^action details$|'s guide$|^a program in /;
const OWN_TOOLS = { memory: "its memory", chats: "your chats", schedule: "its schedules", watch: "its watches" };
// For the moment before a step is classified: its kind arrives with its facts.
const NAME_KINDS = { bash: "command", web_search: "search", fetch_content: "fetch", source_check: "fetch" };

export function actOf(step, failed = false, own = false) {
  const name = step.name || "", facts = step.facts, subject = step.subject || "";
  const known = facts?.kind || step.kind || "other";
  const kind = known === "other" ? NAME_KINDS[name] ?? known : known;
  const act = (value) => failed ? { ...value, failed } : value;
  if (name === "skill" || name === "nothing_to_report" || name === "run_failed") return null;
  if (name === "get_search_content") return failed ? null : { verb: ["reading", "read"], object: "what it found", rank: 3 };
  if (name === "message") {
    const input = step.input ?? {};
    if (input.room && input.room !== "app") return act({ verb: ["emailing", "emailed"], object: "you", rank: 1 });
    if (input.notify === "push" || input.notify === "urgent") return act({ verb: ["notifying", "notified"], object: "your phone", rank: 1 });
    return null;
  }
  // A spawn: a background agent is sent off, a turn's own is waited on. Listing or messaging agents is plumbing.
  if (kind === "agent" || name === "subagent") {
    if (!step.spawn) return null;
    return step.agent?.id?.startsWith("fg-") ? act({ verb: ["waiting on", "asked"], object: "an agent", many: "agents", rank: 2 })
      : act({ verb: ["starting", "started"], object: "an agent", many: "agents", rank: 1 });
  }
  if (name === "approved" || name === "mcp__executor__resume") return act({ verb: ["carrying out", "carried out"], object: "what you approved", rank: 1 });
  // A connector's call, as the hub said it: its own tools are plumbing; a service it reached is the object.
  if (facts?.verb && /^mcp__/.test(name)) {
    if (PLUMBING.test(facts.subject || "")) return null;
    const services = facts.subject || toolName(name) || "a connector";
    if (failed) return { verb: ["trying to reach", "couldn't reach"], object: services, rank: 2, failed };
    if (facts.verb[1] === "Requested") return { verb: kind === "message" ? ["asking to send with", "asked to send with"] : ["asking to change", "asked to change"], object: services, rank: 1 };
    return { verb: ["checking", "checked"], object: services, rank: 2 };
  }
  if (own) {
    if (/(^|_)inbox$/.test(name)) {
      const action = String(step.input?.action || "");
      return act(/^(handle|dismiss|address|reopen)$/.test(action) ? { verb: ["sorting", "sorted"], object: "its inbox", rank: 2 }
        : action === "add" ? { verb: ["noting", "noted"], object: "something for later", rank: 2 } : { verb: ["checking", "checked"], object: "its inbox", rank: 3 });
    }
    if (name === "routine") return act({ verb: ["changing", "changed"], object: "a routine", many: "routines", rank: 2 });
    if (name === "feed") return act({ verb: ["checking", "checked"], object: "its feeds", rank: 3 });
    if (OWN_TOOLS[name]) return act({ verb: kind === "edit" ? ["changing", "changed"] : ["checking", "checked"], object: OWN_TOOLS[name], rank: kind === "edit" ? 2 : 4 });
  }
  if (name === "start_chat") return act({ verb: ["starting", "started"], object: "a chat", many: "chats", rank: 1 });
  if (name === "steer_chat") return act({ verb: ["steering", "steered"], object: "a chat", many: "chats", rank: 1 });
  const mine = own ? ownFile(subject) : null;
  switch (kind) {
    case "search": return act({ verb: ["searching", "searched"], object: "the web", rank: 3 });
    case "fetch": { const site = host(subject); return act({ verb: ["reading", "read"], object: site ? `a page on ${site}` : "a page", many: "pages", rank: 3 }); }
    case "edit": return act(mine ? { verb: ["updating", "updated"], object: mine, rank: 2 } : { verb: ["editing", "edited"], object: "a file", many: "files", rank: 2 });
    case "read": return act(mine ? { verb: ["reading", "read"], object: mine, rank: 4 } : { verb: ["reading", "read"], object: "a file", many: "files", rank: 4 });
    case "command": return act({ verb: ["running", "ran"], object: "a command", many: "commands", rank: 4 });
    case "message": return act({ verb: ["messaging", "messaged"], object: "you", rank: 1 });
    case "script": return null;
    default: {
      const named = toolName(name).replace(/_/g, " ");
      return named ? act({ verb: ["using", "used"], object: named, rank: 4 }) : null;
    }
  }
}

export function digestActs(steps, own = false) {
  const acts = new Map();
  let at = 0;
  for (const { step, failed } of steps) {
    const act = actOf(step, failed, own);
    if (!act) continue;
    // Pages on different sites are one act, "read 3 pages", once there is more than one.
    const key = `${act.verb[1]}|${act.many ?? act.object}`;
    const was = acts.get(key);
    if (was) { was.count += 1; if (was.object !== act.object && act.many) was.object = `a ${act.many.replace(/s$/, "")}`; }
    else acts.set(key, { ...act, count: 1, at: at++ });
  }
  // A service that failed and then answered was reached: the failure is not what was done.
  for (const [key, act] of acts) if (act.failed && [...acts.values()].some((other) => !other.failed && other.object === act.object)) acts.delete(key);
  return [...acts.values()].sort((left, right) => left.rank - right.rank || left.at - right.at);
}

const said = (act) => `${act.verb[1]} ${act.count > 1 && act.many ? `${act.count} ${act.many}` : act.object}`;
export function digestLine(acts) {
  if (!acts.length) return "";
  const [first, second] = acts;
  const more = acts.length - 2;
  return second ? `${said(first)} and ${said(second)}${more > 0 ? `, and ${more} more` : ""}` : said(first);
}

export function doingOf(step, own = false) {
  if (!step.name || step.name === "tool") return "using its tools";
  const act = actOf(step, false, own);
  if (act) return `${act.verb[0]} ${act.object}`;
  return /^mcp__/.test(step.name) ? "finding the right tool" : step.name === "skill" ? "reading a guide" : "using its tools";
}
