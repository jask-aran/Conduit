/*
 * The UI API: every action Conduit's UI takes on command and every view a pane shows, declared once, for the hub
 * (server/ui-control.js) and the client (client/agent-ui.ts) alike. Each says whether an agent may use it (`agent`):
 * the conduit MCP server's `conduit_ui` tool (its actions, parameters and description) is built from those that do,
 * so the tool cannot offer what the UI does not have, or miss what it gains. The client's handlers are typed by
 * the actions `by: "client"`, and its SplitView kinds by the views here (client/workspace/workspace-types.ts): one
 * added or removed on either side fails the typecheck until the other follows.
 */
export const UI_ARGS = /** @type {const} */ ({
  view: { type: "string", says: "For open: what to show, a view from the tool's list such as chat:<id>." },
  pane: { type: "pane", says: "Which pane: main, or a pane's number from look." },
  beside: { type: "boolean", says: "For open: in a new pane beside the one with the keyboard." },
});

/** `by`: who does it, the hub from what clients told it, or the client it is sent to. */
export const UI_ACTIONS = /** @type {const} */ ({
  look: { agent: true, by: "hub", args: [], says: "each open Conduit tab or app (the one in use first), the device it is on where it says (a name the devices tool takes), with its panes, what each shows and which has the keyboard" },
  open: { agent: true, by: "client", args: ["view", "pane", "beside"], says: "show a view in a pane (pane: main or a number; default the one with the keyboard) or beside it (beside: true)" },
  close: { agent: true, by: "client", args: ["pane"], says: "empty a pane (pane required)" },
  focus: { agent: true, by: "client", args: ["pane"], says: "give a pane the keyboard" },
});

/** `kind`: the view's word, or what comes before its colon. `view`: how it is written, `<…>` standing for a value. */
export const UI_VIEWS = /** @type {const} */ ([
  { kind: "chat", view: "chat:<id>", agent: true, says: "" },
  { kind: "page", view: "page:dashboard", agent: true, says: "" },
  { kind: "page", view: "page:agent", agent: true, says: "" },
  { kind: "page", view: "page:jbot", agent: true, says: "" },
  { kind: "page", view: "page:project:<id>", agent: true, says: "" },
  { kind: "browser", view: "browser:hub", agent: true, says: "the hub's browser, which you work through the agent_browser tools" },
  { kind: "terminal", view: "terminal", agent: true, says: "" },
  { kind: "files", view: "files", agent: true, says: "" },
  // A person's own: panes that belong to a chat or a path they picked.
  { kind: "files", view: "files:<path>", agent: false, says: "" },
  { kind: "file", view: "file", agent: false, says: "" },
  { kind: "diff", view: "diff", agent: false, says: "" },
  { kind: "jbot", view: "jbot", agent: false, says: "" },
  { kind: "home", view: "home", agent: false, says: "" },
  { kind: "shell", view: "shell:<id>", agent: false, says: "" },
  { kind: "term", view: "term:<id>", agent: false, says: "" },
]);

const names = (table, test) => Object.entries(table).filter(([, entry]) => test(entry)).map(([name]) => name);
/** The actions an agent may use; the ones a client does (what a command can be). */
export const agentUiActions = () => names(UI_ACTIONS, (entry) => entry.agent);
export const clientUiActions = () => names(UI_ACTIONS, (entry) => entry.by === "client");

const matches = (pattern, view) => new RegExp(`^${pattern.split(/<[^>]+>/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".+")}$`).test(view);
/** The declared view a string is, or undefined; with `agent`, only one an agent may open. */
export const declaredUiView = (view, { agent = false } = {}) =>
  typeof view === "string" ? UI_VIEWS.find((entry) => (!agent || entry.agent) && matches(entry.view, view)) : undefined;
/** The views an agent may open, as its tool lists them. */
export const agentUiViews = () => UI_VIEWS.filter((entry) => entry.agent).map((entry) => entry.says ? `${entry.view} (${entry.says})` : entry.view).join(", ");
