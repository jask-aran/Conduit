import { createEffect, onCleanup } from "solid-js";
import { api } from "./api/client";
import { connectionId } from "./state/runtime";
// Types only: the declaration's words are the hub's to say, and stay out of the client's bundle.
import type { UI_ACTIONS } from "../ui-api.js";

/*
 * What this tab shows, told to the server, and what an agent asks of it, done here (roadmap #11; the server side is
 * server/ui-control.js, the agent's `ui` tool). A tab says its panes -- each pane's document and title, which has the
 * keyboard -- whenever they change, and whether it is in front; a command names this tab (tabs share one stream, so
 * each has an id of its own) and is answered with what came of it.
 */
export type AgentUiPane = { pane: "main" | number; view: string | null; title: string; focused: boolean };
/** The actions a client does, from the UI API's declaration (ui-api.js): a handler for each, and no other. */
export type ClientUiAction = { [K in keyof typeof UI_ACTIONS]: (typeof UI_ACTIONS)[K]["by"] extends "client" ? K : never }[keyof typeof UI_ACTIONS];
export type AgentUiCommand = { action: ClientUiAction; view?: string; pane?: "main" | number; beside?: boolean };
export type AgentUiHandlers = { [K in ClientUiAction]: (command: AgentUiCommand) => Promise<string> | string };

const TAB = (() => { try { return crypto.randomUUID().slice(0, 8); } catch { return Math.random().toString(36).slice(2, 10); } })();

/** This client as the hub names it (`connection/tab`), sent with each message as its origin; "" before the stream is up. */
export const clientId = () => connectionId() ? `${connectionId()}/${TAB}` : "";

export function createAgentUiBridge(deps: {
  connection: () => string;
  panes: () => AgentUiPane[];
  route: () => string;
  actions: AgentUiHandlers;
}) {
  let timer = 0;
  let sent = "";
  const report = (force = false) => {
    const connection = deps.connection();
    if (!connection) return;
    const body = JSON.stringify({ tab: TAB, route: deps.route(), panes: deps.panes(), visible: document.visibilityState === "visible", focused: document.hasFocus() });
    if (!force && body === sent) return;
    sent = body;
    return api(`/v0/runtime/clients/${encodeURIComponent(connection)}/view`, { method: "POST", headers: { "content-type": "application/json" }, body }).catch(() => { sent = ""; });
  };
  // Changes settle for a moment before they are told: a pane opening is several changes.
  createEffect(() => {
    deps.connection(); deps.route(); JSON.stringify(deps.panes());
    clearTimeout(timer);
    timer = window.setTimeout(() => void report(), 300);
  });
  const presence = () => void report();
  window.addEventListener("focus", presence);
  window.addEventListener("blur", presence);
  document.addEventListener("visibilitychange", presence);

  const onCommand = (event: Event) => {
    const detail = (event as CustomEvent<{ id: string; tab: string; command: AgentUiCommand }>).detail;
    if (!detail || detail.tab !== TAB) return;
    const answer = (body: { ok: boolean; result?: string; error?: string }) => api(`/v0/runtime/clients/${encodeURIComponent(deps.connection())}/commands/${encodeURIComponent(detail.id)}`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
    // What came of it is told with the view it left, so a look straight after sees it.
    const handler = Object.hasOwn(deps.actions, detail.command?.action) ? deps.actions[detail.command.action] : null;
    if (!handler) return void answer({ ok: false, error: `Not something this client does: ${String(detail.command?.action)}` });
    void Promise.resolve().then(() => handler(detail.command))
      .then(async (result) => { await new Promise((resolve) => window.setTimeout(resolve, 250)); await report(true); await answer({ ok: true, result }); })
      .catch((error) => answer({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  };
  window.addEventListener("conduit:ui-command", onCommand);
  onCleanup(() => {
    clearTimeout(timer);
    window.removeEventListener("focus", presence);
    window.removeEventListener("blur", presence);
    document.removeEventListener("visibilitychange", presence);
    window.removeEventListener("conduit:ui-command", onCommand);
  });
}
