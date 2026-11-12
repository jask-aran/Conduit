/*
 * The `conduit_ui` tool is built from the entries marked `agent`, so it cannot offer what the UI does not have. The
 * client's handlers and SplitView kinds are typed from here: one added or removed on either side fails the typecheck.
 */
export const UI_ARGS = /** @type {const} */ ({
  view: { type: "string", says: "For open: what to show, a view from the tool's list such as chat:<id>." },
  pane: { type: "pane", says: "Which pane: main, or a pane's number from look." },
  beside: { type: "boolean", says: "For open: in a new pane beside the one with the keyboard." },
});

// `by`: the hub, from what clients told it, or the client the action is sent to.
export const UI_ACTIONS = /** @type {const} */ ({
  look: { agent: true, by: "hub", args: [], says: "each open Conduit tab or app (the one in use first), the device it is on where it says (a name the devices tool takes), with its panes, what each shows and which has the keyboard" },
  screens: { agent: true, by: "hub", args: [], says: "the screens that can be shown (a device's browser and the like): each one's view, its device and the clients showing it" },
  open: { agent: true, by: "client", args: ["view", "pane", "beside"], says: "show a view in a pane (pane: main or a number; default the one with the keyboard) or beside it (beside: true)" },
  close: { agent: true, by: "client", args: ["pane"], says: "empty a pane (pane required)" },
  focus: { agent: true, by: "client", args: ["pane"], says: "give a pane the keyboard" },
});

export const UI_VIEWS = /** @type {const} */ ([
  { kind: "chat", view: "chat:<id>", agent: true, says: "" },
  { kind: "page", view: "page:dashboard", agent: true, says: "" },
  { kind: "page", view: "page:agent", agent: true, says: "" },
  { kind: "page", view: "page:jbot", agent: true, says: "" },
  { kind: "page", view: "page:project:<id>", agent: true, says: "" },
  { kind: "browser", view: "browser:hub", agent: true, says: "the hub's browser, which you work through codemode's browser namespace; it follows the page, so open it once" },
  { kind: "browser", view: "browser:<device>", agent: true, says: "a device's browser, by its view from screens: for the person to see and use; your browser tools work the hub's" },
  { kind: "artifact", view: "artifact:<id>", agent: true, says: "an artifact by its id: a paper the person and agents write together, or a site an agent builds as one HTML file" },
  { kind: "terminal", view: "terminal", agent: true, says: "" },
  { kind: "files", view: "files", agent: true, says: "" },
  { kind: "files", view: "files:<path>", agent: false, says: "" },
  { kind: "file", view: "file", agent: false, says: "" },
  { kind: "diff", view: "diff", agent: false, says: "" },
  { kind: "jbot", view: "jbot", agent: false, says: "" },
  { kind: "home", view: "home", agent: false, says: "" },
  { kind: "shell", view: "shell:<id>", agent: false, says: "" },
  { kind: "term", view: "term:<id>", agent: false, says: "" },
]);

const names = (table, test) => Object.entries(table).filter(([, entry]) => test(entry)).map(([name]) => name);
export const agentUiActions = () => names(UI_ACTIONS, (entry) => entry.agent);
export const clientUiActions = () => names(UI_ACTIONS, (entry) => entry.by === "client");

const matches = (pattern, view) => new RegExp(`^${pattern.split(/<[^>]+>/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".+")}$`).test(view);
export const declaredUiView = (view, { agent = false } = {}) =>
  typeof view === "string" ? UI_VIEWS.find((entry) => (!agent || entry.agent) && matches(entry.view, view)) : undefined;
export const agentUiViews = () => UI_VIEWS.filter((entry) => entry.agent).map((entry) => entry.says ? `${entry.view} (${entry.says})` : entry.view).join(", ");
