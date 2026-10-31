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
export function connectorPaths(name, args) {
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

/** A gateway tool's step subject: the services it reaches, each once ("Google Calendar, Gmail"); null for none. */
export function connectorSubject(name, args) {
  const services = [...new Set(connectorPaths(name, args).map(serviceOf).filter(Boolean))];
  return services.length ? services.join(", ") : null;
}
