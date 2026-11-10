import { randomBytes } from "node:crypto";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import { callingChat } from "./conduit-mcp.js";
import { agentUiActions, agentUiViews, declaredUiView, UI_ACTIONS, UI_ARGS } from "../ui-api.js";

const ARG_TYPES = { string: (options) => Type.String(options), boolean: (options) => Type.Boolean(options),
  pane: (options) => Type.Union([Type.Literal("main"), Type.Number()], options) };

/*
 * Agents drive Conduit's UI (roadmap #11): what each open tab of Conduit shows, as it tells us (client agent-ui.ts),
 * and commands sent to one tab over its runtime stream, answered over HTTP. The `conduit_ui` tool (UiTool) is how
 * agents use it, one of the conduit MCP server's (conduit-mcp.js); GET /v0/ui and POST /v0/ui/commands are the same for a CLI.
 *
 * A tab is `connection/tab`: tabs of one browser share a stream (its connection), each with its own id. With none
 * named, an agent's command goes to its chat's origin (the tab the person last wrote to it from), else a tab showing
 * the chat, else the tab the person is using: the one with focus, else one in view, else the latest to say.
 */
const ANSWER_MS = 10_000;

export class UiControl {
  constructor({ runtimeHub }) {
    this.hub = runtimeHub;
    this.views = new Map();
    this.pending = new Map();
    this.origins = new Map();
  }

  /** A chat's origin: the client its latest message was sent from, as the send says it. */
  sentFrom(chatId, client) {
    if (!chatId || typeof client !== "string" || !/^[\w-]{1,64}\/[\w-]{1,16}$/.test(client)) return;
    this.origins.set(chatId, client);
  }

  /**
   * The tab a chat's command goes to with none named: its origin, else a tab showing the chat, else the one in use.
   * A chat whose origin has closed is not left pointing at it.
   */
  targetFor(chatId, tabs = this.look()) {
    const origin = chatId && this.origins.get(chatId);
    return (origin && tabs.find((tab) => tab.client === origin))
      || (chatId && tabs.find((tab) => tab.panes.some((pane) => pane.view === `chat:${chatId}`)))
      || tabs[0] || null;
  }

  /** A tab's view, as it says it. Kept while its connection lasts. */
  report(connection, body) {
    if (!this.hub.connections().some((peer) => peer.id === connection)) return false;
    const tab = String(body?.tab || "").slice(0, 16);
    if (!tab) return false;
    const panes = (Array.isArray(body.panes) ? body.panes : []).slice(0, 8).map((pane) => ({
      pane: pane?.pane === "main" ? "main" : Number(pane?.pane), view: typeof pane?.view === "string" ? pane.view.slice(0, 200) : null,
      title: String(pane?.title || "").slice(0, 120), focused: pane?.focused === true }));
    this.views.set(`${connection}/${tab}`, { client: `${connection}/${tab}`, connection, tab, route: String(body.route || "").slice(0, 40), panes,
      visible: body.visible === true, focused: body.focused === true, at: Date.now() });
    return true;
  }

  /** Every open tab: its client (which device and app it is) and its panes, the one in use first. */
  look() {
    const peers = new Map(this.hub.connections().map((peer) => [peer.id, peer]));
    for (const key of this.views.keys()) if (!peers.has(this.views.get(key).connection)) this.views.delete(key);
    return [...this.views.values()].sort((a, b) => rank(b) - rank(a)).map((view) => {
      const peer = peers.get(view.connection);
      return { client: view.client, app: peer.kind, platform: peer.platform || null, machine: peer.machine || null,
        inUse: view.focused, visible: view.visible, route: view.route, panes: view.panes };
    });
  }

  /** Send a command to a tab (`client`, or the calling chat's: targetFor) and wait for what came of it. */
  async command(command, client = null, chatId = null) {
    const tabs = this.look();
    const target = client ? tabs.find((tab) => tab.client === client) : this.targetFor(chatId, tabs);
    if (!target) throw Object.assign(new Error(client ? `No open Conduit tab ${client}` : "Conduit is not open anywhere right now"), { status: 409 });
    const id = randomBytes(6).toString("hex");
    const [connection, tab] = target.client.split("/");
    const answer = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Object.assign(new Error("The Conduit tab did not answer"), { status: 504 })); }, ANSWER_MS);
      timer.unref?.();
      this.pending.set(id, { connection, resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    });
    if (!this.hub.sendTo(connection, { type: "ui_command", id, tab, command })) {
      this.pending.get(id)?.reject(Object.assign(new Error("That Conduit tab has gone"), { status: 409 }));
      this.pending.delete(id);
    }
    const result = await answer;
    return { client: target.client, result };
  }

  /** A tab's answer to a command it was sent. */
  answer(connection, id, body) {
    const waiting = this.pending.get(id);
    if (!waiting || waiting.connection !== connection) return false;
    this.pending.delete(id);
    if (body?.ok) waiting.resolve(String(body.result || "Done."));
    else waiting.reject(Object.assign(new Error(String(body?.error || "The tab could not do that")), { status: 422 }));
    return true;
  }
}

const rank = (view) => (view.focused ? 2e13 : 0) + (view.visible ? 1e13 : 0) + view.at;

/** The `conduit_ui` tool's description of a look: one line per tab, then its panes. */
export function describeLook(tabs, yours = null) {
  if (!tabs.length) return "Conduit is not open anywhere right now.";
  return tabs.map((tab, index) => [
    `${tab.client === yours ? "Yours (where the person is talking to you from; commands go here): " : ""}${index === 0 ? "In use: " : ""}${tab.client} (${[tab.app, tab.platform, tab.machine].filter(Boolean).join(", ")})${tab.inUse ? " has focus" : tab.visible ? " is in view" : " is in the background"}`,
    ...tab.panes.map((pane) => `  pane ${pane.pane}${pane.focused ? " (keyboard)" : ""}: ${pane.view ? `${pane.title} [${pane.view}]` : "empty"}`),
  ].join("\n")).join("\n");
}

/**
 * The `conduit_ui` tool: an agent sees what the person has open in Conduit and arranges it, as they would. Every profile's
 * chats have it; a subagent's child does not (no one is watching it work).
 */
export function UiTool(runtime) {
  const actions = agentUiActions();
  const args = Object.keys(UI_ARGS).filter((name) => actions.some((action) => UI_ACTIONS[action].args.includes(name)));
  const text = (value, isError = false) => ({ output: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) });
  return defineTool({
    name: "conduit_ui",
    // Built from the UI API (ui-api.js): the actions and views declared for agents, and only those.
    description: `See and arrange what the person has open in Conduit. ${actions.map((name) => `${name}: ${UI_ACTIONS[name].says}.`).join(" ")} `
      + `Views: ${agentUiViews()}. Commands go to the tab the person is talking to you from (look marks it Yours; else the one in use) `
      + "unless client names another. Arrange their screen only when they asked, or when it plainly helps them follow your work.",
    parameters: Type.Object({
      action: Type.Union(actions.map((value) => Type.Literal(value))),
      ...Object.fromEntries(args.map((name) => [name, Type.Optional(ARG_TYPES[UI_ARGS[name].type]({ description: UI_ARGS[name].says }))])),
      client: Type.Optional(Type.String({ description: "Another tab from look (connection/tab); default yours." })),
    }),
    replay: "unsafe",
    execute: async ({ action, view, pane, beside, client }, api, context) => {
      const control = runtime.uiControl;
      if (!control) return text("Conduit's UI cannot be reached from here.", true);
      const chatId = await callingChat(runtime, api, context);
      if (!actions.includes(action)) return text(`Not an action: ${action}.`, true);
      if (view !== undefined && !declaredUiView(view, { agent: true })) return text(`Not a view you can open: ${view}. Views: ${agentUiViews()}.`, true);
      if (action === "look") { const tabs = control.look(); return text(describeLook(tabs, chatId ? control.targetFor(chatId, tabs)?.client : null)); }
      try {
        const { client: tab, result } = await control.command({ action, ...(view ? { view } : {}), ...(pane !== undefined ? { pane } : {}), ...(beside ? { beside: true } : {}) }, client || null, chatId);
        return text(`${result} (${tab})`);
      } catch (error) { return text(error.message, true); }
    },
  });
}
