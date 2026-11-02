import { createEffect, onCleanup } from "solid-js";
import { api } from "./api/client";

/*
 * What this tab shows, told to the server, and what an agent asks of it, done here (roadmap #11; the server side is
 * server/ui-control.js, the agent's `ui` tool). A tab says its panes -- each pane's document and title, which has the
 * keyboard -- whenever they change, and whether it is in front; a command names this tab (tabs share one stream, so
 * each has an id of its own) and is answered with what came of it.
 */
export type AgentUiPane = { pane: "main" | number; view: string | null; title: string; focused: boolean };
export type AgentUiCommand = { action: "open" | "close" | "focus"; view?: string; pane?: "main" | number; beside?: boolean };

const TAB = (() => { try { return crypto.randomUUID().slice(0, 8); } catch { return Math.random().toString(36).slice(2, 10); } })();

export function createAgentUiBridge(deps: {
  connection: () => string;
  panes: () => AgentUiPane[];
  route: () => string;
  run: (command: AgentUiCommand) => Promise<string>;
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
    void deps.run(detail.command)
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
