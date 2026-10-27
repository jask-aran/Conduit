import crypto from "node:crypto";
import { chatView } from "../../chat-store.js";
import { listWatches, webhook } from "../../agent/events.js";
import { acceptProposal, listProposals, rejectProposal } from "../../agent/memory.js";
import { listSchedules } from "../../agent/schedule.js";
import { backgroundSubagents } from "../subagents.js";

/**
 * The hub's persistent agent over HTTP (docs/plans/persistent-agent.md).
 *
 * GET  /v0/agent                     the agent, its threads and its attention list
 * POST /v0/agent                     give this hub its agent { name? }
 * PATCH /v0/agent                    its settings (name, dial, budgetUsdPerDay, timezone, brief, heartbeat)
 * POST /v0/agent/threads             a side thread { title? }
 * POST /v0/agent/wake                a run now { task, title? }
 * POST /v0/agent/proposals/:id/{accept,reject}
 * DELETE /v0/agent/notices/:id      a notice read (it leaves the attention list)
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
  const attention = async (view) => {
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
    const state = await agent.state();
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
        proposals: await listProposals(agent),
        notices: state.notices,
      },
    };
  };

  app.get("/v0/agent", async (request, response, next) => {
    try {
      const view = await agent.view();
      response.json(view.enabled ? { ...view, attention: await attention(view) } : view);
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
