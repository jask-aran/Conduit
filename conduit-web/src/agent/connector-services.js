/**
 * What a gateway connector's call reaches, by service: Executor puts every app behind `call` and `execute`, so a step
 * that says "Executor" says nothing. Its actions are paths (`tools.google.api.calendar.events.calendarEventsList`);
 * the service is the app and, for Google, its API ("Google Calendar", "Gmail"). Executor's own tools (search,
 * describe, skills) reach no service.
 */
const NAMED = [
  ["google.api.calendar", "Google Calendar"], ["google.api.drive", "Google Drive"], ["google.api.docs", "Google Docs"],
  ["google.api.sheets", "Google Sheets"], ["google.api.forms", "Google Forms"], ["google.api.meet", "Google Meet"],
  ["google.api.tasks", "Google Tasks"], ["google.tasks", "Google Tasks"], ["google.api.gmail", "Gmail"], ["gmail", "Gmail"],
  ["github", "GitHub"], ["posthog", "PostHog"],
];
const OWN = new Set(["executor", "search", "describe", "skills"]);
const titled = (word) => word ? `${word[0].toUpperCase()}${word.slice(1)}` : "";

/** The service an action path reaches, or null for the gateway's own. */
export function serviceOf(path) {
  const clean = String(path || "").replace(/^tools\./, "");
  const named = NAMED.find(([prefix]) => clean === prefix || clean.startsWith(`${prefix}.`));
  if (named) return named[1];
  const app = clean.split(".")[0];
  return !app || OWN.has(app) ? null : titled(app);
}

/** The action paths a gateway tool's input names: a call's `calls`, or a program's literal `tools.…(` uses. */
function connectorPaths(name, args) {
  const tool = String(name).split("__").slice(2).join("__");
  // History keeps a call's arguments as a JSON preview, cut short when long: its paths are read off the text.
  if (typeof args?.preview === "string") return [...args.preview.matchAll(/"path"\s*:\s*"(tools\.[^"]+)"|\btools\s*\[\s*\\?["'`](tools\.[^"'`\\]+)|\btools((?:\.[A-Za-z_$][\w$]*)+)\s*\(/g)]
    .map((match) => match[1] ?? match[2] ?? match[3].slice(1));
  if (tool === "call") {
    const calls = Array.isArray(args?.calls) ? args.calls : args?.calls ? [args.calls] : [];
    return calls.map((call) => String(call?.path || ""));
  }
  if (tool === "execute") {
    const code = String(args?.code ?? args?.source ?? args?.program ?? "");
    return [...code.matchAll(/\btools\s*\[\s*["'`]([^"'`$]+)["'`]\s*\]|\btools((?:\s*\.\s*[A-Za-z_$][\w$]*)+)\s*\(/g)]
      .map((match) => match[1] ?? match[2].replace(/\s/g, "").slice(1));
  }
  return [];
}

/**
 * A connector call said as what it did (ToolFacts: verb present/past, kind, subject, aside): "Checked Gmail · search",
 * "Sent with Gmail", "Looked up Executor actions · calendar events". A gateway's own tools are what they are for.
 */
const READS = /^(get|list|search|query|read|export|describe|check|find|lookup|fetch|count|batchget)$/;
const SENDS = /^(send|reply|forward|share|post|submit|publish|invite)$/;
const DELETES = /^(delete|remove|trash|empty|batchdelete|purge|destroy|cancel|unsubscribe|revoke|disconnect|clear)$/;
const words = (path) => String(path).split(".").at(-1).split(/[^A-Za-z0-9]+/).flatMap((part) => part.split(/(?<=[a-z0-9])(?=[A-Z])/)).map((word) => word.toLowerCase()).filter(Boolean);
const actionOf = (path) => { const list = words(path); const tail = list.filter((word, index) => word !== list[index - 1] && !/^(gmail|users|calendar|drive|docs|sheets|tasks)$/.test(word)); return tail.join(" "); };
export function connectorFacts(name, args) {
  const tool = String(name).split("__").slice(2).join("__");
  const gateway = titled(String(name).split("__")[1] || "");
  if (tool === "search") return { verb: ["Looking up", "Looked up"], kind: "search", subject: `${gateway} actions`, ...(args?.query ? { aside: String(args.query).slice(0, 80) } : {}) };
  if (tool === "describe") return { verb: ["Reading", "Read"], kind: "read", subject: "action details", ...(args?.path ? { aside: actionOf(args.path) } : {}) };
  if (tool === "skills") return { verb: ["Reading", "Read"], kind: "read", subject: `${gateway}'s guide` };
  const paths = connectorPaths(name, args);
  const services = [...new Set(paths.map(serviceOf).filter(Boolean))];
  if (!paths.length || !services.length) return tool === "execute" ? { verb: ["Running", "Ran"], kind: "script", subject: `a program in ${gateway}` } : null;
  const all = paths.flatMap(words);
  const sends = all.some((word) => SENDS.test(word)), deletes = all.some((word) => DELETES.test(word));
  const reads = paths.every((path) => words(path).some((word) => READS.test(word)) && !words(path).some((word) => !READS.test(word) && (SENDS.test(word) || DELETES.test(word))));
  const actions = [...new Set(paths.map(actionOf).filter(Boolean))];
  const aside = actions.length ? actions.slice(0, 2).join(", ") + (actions.length > 2 ? ` +${actions.length - 2}` : "") : undefined;
  const subject = services.join(", ");
  // A write may only have asked the person (an approval): said as requested, which is true either way.
  if (sends || deletes || !reads) return { verb: ["Requesting", "Requested"], kind: sends ? "message" : "edit", subject, ...(aside ? { aside } : {}) };
  // A single read's query, where it has one, says more than its action.
  const calls = Array.isArray(args?.calls) ? args.calls : args?.calls ? [args.calls] : [];
  const query = calls.length === 1 ? calls[0]?.input?.query ?? calls[0]?.input?.q : null;
  return { verb: ["Checking", "Checked"], kind: actions.some((action) => /search|list|query|find/.test(action)) ? "search" : "read", subject,
    ...(typeof query === "string" && query.trim() ? { aside: `\u201c${query.trim().slice(0, 60)}\u201d` } : aside ? { aside } : {}) };
}

/** A gateway tool's step subject: the services it reaches, each once ("Google Calendar, Gmail"); null for none. */
export function connectorSubject(name, args) {
  const services = [...new Set(connectorPaths(name, args).map(serviceOf).filter(Boolean))];
  return services.length ? services.join(", ") : null;
}
