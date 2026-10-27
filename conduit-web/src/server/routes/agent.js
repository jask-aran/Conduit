import crypto from "node:crypto";
import { safeRedirectTarget } from "../../auth-middleware.js";
import { originOfRequest } from "../../server-identity.js";
import { chatView } from "../../chat-store.js";
import { listWatches, webhook } from "../../agent/events.js";
import { acceptProposal, listProposals, rejectProposal } from "../../agent/memory.js";
import { listSchedules } from "../../agent/schedule.js";
import { decide } from "../../agent/asks.js";
import { backgroundSubagents } from "../subagents.js";

/**
 * The hub's persistent agent over HTTP (docs/plans/persistent-agent.md).
 *
 * GET  /v0/agent                     the agent, its threads and its attention list
 * POST /v0/agent                     give this hub its agent { name? }
 * PATCH /v0/agent                    its settings (name, dial, budgetUsdPerDay, timezone, brief, heartbeat)
 * POST /v0/agent/asks/:id            decide an approval { choice }
 * POST /v0/agent/threads             a side thread { title? }
 * POST /v0/agent/wake                a run now { task, title? }
 * POST /v0/agent/proposals/:id/{accept,reject}
 * DELETE /v0/agent/notices/:id      a notice read (it leaves the attention list)
 * DELETE /v0/agent/rules/:id        remove a saved approval rule
 * GET  /v0/agent/connectors         connector status
 * GET  /v0/agent/connectors/:id/tools  what a connected one offers (name, description, read-only)
 * POST /v0/agent/connectors/:id/connect  start OAuth
 * GET  /v0/agent/connectors/:id/callback  finish OAuth (no session; state is the secret)
 * DELETE /v0/agent/connectors/:id    disconnect
 * POST /v0/agent/hooks/:token        a webhook: wakes it with the request's body (no session; the token is the secret)
 */
export function registerAgentRoutes(app, { agent, backends }) {
  const enabled = (response) => {
    if (agent.enabled()) return true;
    response.status(409).json({ error: "agent_not_enabled" });
    return false;
  };

  /**
   * What is under way and what needs the person. Working: its runs still going
   * and its clocks. Needs you: a question or approval waiting in one of its
   * threads, memory its runs proposed, and notices (a budget reached).
   */
  const attention = async (view, state) => {
    const harness = await agent.runtime.open();
    const runs = view.home?.conversationId ? await backgroundSubagents(harness, view.home.conversationId, agent.context) : [];
    const threads = [view.home?.chatId, ...view.sides.map((side) => side.chatId)].filter(Boolean);
    const waiting = threads.flatMap((chatId) => (backends.getByChatId(chatId)?.hostUiRequests || [])
      .map((request) => ({ kind: "question", chatId, requestId: request.id, title: request.title || "A question" })));
    // A run waits on no one (it cannot ask); a thread whose chat is not live may still have a question pending.
    for (const conversationId of agent.runtime.askerWaits?.keys() || []) {
      const thread = await agent.describe(conversationId);
      if (thread?.chatId && !waiting.some((item) => item.chatId === thread.chatId)) waiting.push({ kind: "question", chatId: thread.chatId, requestId: null, title: "A question" });
    }
    return {
      working: {
        runs: runs.filter((run) => run.origin && run.status === "running")
          .map((run) => ({ id: run.id, title: run.title, kind: run.origin.kind, startedAt: run.startedAt, conversationId: run.child })),
        recent: runs.filter((run) => run.origin && run.status !== "running").slice(-10).reverse()
          .map((run) => ({ id: run.id, title: run.title, kind: run.origin.kind, status: run.status, level: run.level || null, endedAt: run.endedAt, conversationId: run.child })),
        schedules: await listSchedules(agent),
        watches: await listWatches(agent),
      },
      needsYou: {
        questions: waiting,
        asks: view.asks.filter((ask) => ask.status === "pending"),
        proposals: await listProposals(agent),
        notices: state.notices,
      },
    };
  };

  app.get("/v0/agent/connectors", (request, response) => {
    if (!enabled(response)) return;
    response.json(agent.connectors.list());
  });

  app.get("/v0/agent/connectors/:id/tools", (request, response) => {
    if (!enabled(response)) return;
    try { response.json(agent.connectors.describe(request.params.id)); }
    catch (error) { response.status(error.status === 404 ? 404 : 500).json({ error: error.status === 404 ? "connector_not_found" : "connector_failed" }); }
  });

  app.post("/v0/agent/connectors/:id/connect", async (request, response, next) => {
    try {
      if (!enabled(response)) return;
      // The person's browser comes back to the address it used (behind a TLS front, its forwarded scheme).
      const origin = originOfRequest(request);
      if (!origin) return response.status(400).json({ error: "bad_origin" });
      const returnTo = typeof request.body?.returnTo === "string" ? safeRedirectTarget(request.body.returnTo) : null;
      const authorizationUrl = await agent.connectors.begin(request.params.id, origin, returnTo);
      response.json({ authorizationUrl });
    } catch (error) { if (error.status === 404) return response.status(404).json({ error: "connector_not_found" }); response.status(502).json({ error: "connector_authorization_failed" }); }
  });

  app.get("/v0/agent/connectors/:id/callback", async (request, response, next) => {
    try {
      if (!agent.enabled()) return response.status(400).send("Invalid authorization state");
      const returnTo = await agent.connectors.finish(request.params.id, request.query.state, request.query.code, request.query.iss);
      if (agent.connectors.entry(request.params.id).status !== "on") return response.status(502).send("Connector connection failed");
      if (returnTo) return response.redirect(303, safeRedirectTarget(returnTo));
      // The tab Settings opened closes itself; one a native app handed to the system browser cannot, and says so.
      const label = agent.connectors.entry(request.params.id).info.label;
      response.type("html").send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${label} connected</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,sans-serif;background:#111;color:#e8e8e8}@media (prefers-color-scheme:light){body{background:#f6f6f4;color:#1a1a1a}}p{margin:0;text-align:center}small{display:block;opacity:.6;margin-top:4px}</style>
<p>${label} is connected to Conduit.<small>You can close this tab.</small></p><script>window.close()</script>`);
    } catch (error) {
      // The reason, never the code or a token: OAuth errors name what failed, not the secrets.
      if (error.status !== 400) console.error(`[agent] connector ${request.params.id} authorization failed: ${error.name}: ${error.message}`);
      response.status(error.status === 400 ? 400 : 502).send(error.status === 400 ? "Invalid authorization state" : `Connector authorization failed: ${error.message}`);
    }
  });

  app.delete("/v0/agent/connectors/:id", async (request, response, next) => {
    try {
      if (!enabled(response)) return;
      await agent.connectors.disconnect(request.params.id);
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.get("/v0/agent", async (request, response, next) => {
    try {
      const state = agent.enabled() ? await agent.state() : null;
      const view = await agent.view(state);
      response.json(view.enabled ? { ...view, attention: await attention(view, state) } : view);
    } catch (error) { next(error); }
  });

  app.post("/v0/agent", async (request, response, next) => {
    try {
      const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
      response.status(201).json(await agent.enable(name ? { name } : {}));
    } catch (error) { next(error); }
  });

  app.patch("/v0/agent", async (request, response, next) => {
    try {
      if (!enabled(response)) return;
      await agent.saveSettings(request.body || {});
      response.json(await agent.view());
    } catch (error) { next(error); }
  });

  app.post("/v0/agent/asks/:id", async (request, response, next) => {
    try {
      if (!enabled(response)) return;
      response.json(await decide(agent, request.params.id, request.body?.choice));
    } catch (error) {
      if ([400, 404, 409].includes(error.status)) return response.status(error.status).json({ error: error.message });
      next(error);
    }
  });

  app.post("/v0/agent/threads", async (request, response, next) => {
    try {
      if (!enabled(response)) return;
      response.status(201).json(chatView(await agent.side(String(request.body?.title || "").trim().slice(0, 120))));
    } catch (error) { next(error); }
  });

  app.post("/v0/agent/wake", async (request, response, next) => {
    try {
      if (!enabled(response)) return;
      const task = String(request.body?.task || "").trim();
      if (!task) return response.status(400).json({ error: "invalid_task" });
      const run = await agent.wake({ key: `manual:${crypto.randomUUID()}`, kind: "manual", title: String(request.body?.title || "").trim() || undefined, task });
      response.status(run ? 202 : 409).json(run ? { id: run.id, conversationId: run.child } : { error: "agent_over_budget" });
    } catch (error) { next(error); }
  });

  for (const [verb, act] of [["accept", acceptProposal], ["reject", rejectProposal]]) {
    app.post(`/v0/agent/proposals/:id/${verb}`, async (request, response, next) => {
      try {
        if (!enabled(response)) return;
        const done = await act(agent, request.params.id);
        response.status(done ? 200 : 404).json(done || { error: "proposal_not_found" });
      } catch (error) { next(error); }
    });
  }

  app.delete("/v0/agent/rules/:id", async (request, response, next) => {
    try {
      if (!enabled(response)) return;
      let found = false;
      await agent.update((doc) => {
        if (Object.hasOwn(doc.rules || {}, request.params.id)) { delete doc.rules[request.params.id]; found = true; }
      });
      response.status(found ? 204 : 404).end();
    } catch (error) { next(error); }
  });

  app.delete("/v0/agent/notices/:id", async (request, response, next) => {
    try {
      if (!enabled(response)) return;
      let found = false;
      await agent.update((doc) => {
        const index = doc.notices.findIndex((notice) => notice.id === request.params.id);
        if (index >= 0) { doc.notices.splice(index, 1); found = true; }
      });
      response.status(found ? 204 : 404).end();
    } catch (error) { next(error); }
  });

  app.post("/v0/agent/hooks/:token", async (request, response, next) => {
    try {
      if (!agent.enabled()) return response.status(404).json({ error: "not_found" });
      const run = await webhook(agent, request.params.token, request.body);
      // An unknown token says no more than a missing route would.
      response.status(run === null ? 404 : 202).json(run === null ? { error: "not_found" } : { accepted: true });
    } catch (error) { next(error); }
  });
}
