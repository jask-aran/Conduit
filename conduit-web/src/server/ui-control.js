import { randomBytes } from "node:crypto";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import { callingChat } from "./conduit-mcp.js";
import { reachableDevices } from "./device-tools.js";
import { describeScreens } from "./screens.js";
import { agentUiActions, agentUiViews, declaredUiView, UI_ACTIONS, UI_ARGS } from "../ui-api.js";

const ARG_TYPES = { string: (options) => Type.String(options), boolean: (options) => Type.Boolean(options),
  pane: (options) => Type.Union([Type.Literal("main"), Type.Number()], options) };

/*
 * Agents drive Conduit's UI: each tab reports what it shows, and commands go to one tab over its runtime stream,
 * answered over HTTP. A tab is `connection/tab`, since tabs of one browser share a stream.
 */
const ANSWER_MS = 10_000;

export class UiControl {
  constructor({ runtimeHub, nodeHub = null }) {
    this.hub = runtimeHub;
    this.nodeHub = nodeHub;
    this.views = new Map();
    this.pending = new Map();
    this.origins = new Map();
  }

  sentFrom(chatId, client) {
    if (!chatId || typeof client !== "string" || !/^[\w-]{1,64}\/[\w-]{1,16}$/.test(client)) return;
    this.origins.set(chatId, client);
  }

  async targetFor(chatId, tabs = null) {
    tabs ||= await this.look();
    const origin = chatId && this.origins.get(chatId);
    return (origin && tabs.find((tab) => tab.client === origin))
      || (chatId && tabs.find((tab) => tab.panes.some((pane) => pane.view === `chat:${chatId}`)))
      || tabs[0] || null;
  }

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

  /** A client's devices are its own word: enough to aim at, never a grant. */
  async look() {
    const named = new Map((await reachableDevices(this.nodeHub).catch(() => [])).map((device) => [device.nodeId, device.name]));
    const peers = new Map(this.hub.connections().map((peer) => [peer.id, peer]));
    for (const key of this.views.keys()) if (!peers.has(this.views.get(key).connection)) this.views.delete(key);
    return [...this.views.values()].sort((a, b) => rank(b) - rank(a)).map((view) => {
      const peer = peers.get(view.connection);
      return { client: view.client, app: peer.kind, platform: peer.platform || null, machine: peer.machine || null,
        devices: (peer.nodes || []).map((node) => named.get(node)).filter(Boolean),
        inUse: view.focused, visible: view.visible, route: view.route, panes: view.panes };
    });
  }

  async command(command, client = null, chatId = null) {
    const tabs = await this.look();
    const target = client ? tabs.find((tab) => tab.client === client) : await this.targetFor(chatId, tabs);
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

function describeLook(tabs, yours = null) {
  if (!tabs.length) return "Conduit is not open anywhere right now.";
  return tabs.map((tab, index) => [
    `${tab.client === yours ? "Yours (where the person is talking to you from; commands go here): " : ""}${index === 0 ? "In use: " : ""}${tab.client} (${[tab.app, tab.platform, tab.machine].filter(Boolean).join(", ")})${tab.devices.length ? ` on device ${tab.devices.join(", ")}` : ""}${tab.inUse ? " has focus" : tab.visible ? " is in view" : " is in the background"}`,
    ...tab.panes.map((pane) => `  pane ${pane.pane}${pane.focused ? " (keyboard)" : ""}: ${pane.view ? `${pane.title} [${pane.view}]` : "empty"}`),
  ].join("\n")).join("\n");
}

export function UiTool(runtime) {
  const actions = agentUiActions();
  const args = Object.keys(UI_ARGS).filter((name) => actions.some((action) => UI_ACTIONS[action].args.includes(name)));
  const text = (value, isError = false) => ({ output: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) });
  return defineTool({
    name: "conduit_ui",
    description: `See and arrange what the person has open in Conduit. ${actions.map((name) => `${name}: ${UI_ACTIONS[name].says}.`).join(" ")} `
      + `Views: ${agentUiViews()}. Commands go to the tab the person is talking to you from, with nothing more said: `
      + "open needs no look or screens first, and client only to reach another tab. Arrange their screen only when they asked, or when it plainly helps them follow your work.",
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
      if (action === "screens") return runtime.screens ? text(describeScreens(await runtime.screens.list())) : text("Screens cannot be reached from here.", true);
      if (action === "look") { const tabs = await control.look(); return text(describeLook(tabs, chatId ? (await control.targetFor(chatId, tabs))?.client : null)); }
      try {
        // Nothing is sent when already shown, so a page the person watches is not redrawn for each step.
        if (action === "open" && view && pane === undefined && !beside) {
          const tabs = await control.look();
          const target = client ? tabs.find((tab) => tab.client === client) : await control.targetFor(chatId, tabs);
          const shown = target?.panes.find((item) => item.view === view);
          if (shown) return text(`Already showing in pane ${shown.pane} (${target.client}); it follows what you do. Nothing changed.`);
        }
        const { client: tab, result } = await control.command({ action, ...(view ? { view } : {}), ...(pane !== undefined ? { pane } : {}), ...(beside ? { beside: true } : {}) }, client || null, chatId);
        return text(`${result} (${tab})`);
      } catch (error) { return text(error.message, true); }
    },
  });
}
