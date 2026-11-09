import crypto from "node:crypto";
import express from "express";
import { voiceTranscriber } from "./voice.js";
import path from "node:path";
import { safeRedirectTarget } from "../../auth-middleware.js";
import { originOfRequest } from "../../server-identity.js";
import { chatView } from "../../chat-store.js";
import { listWatches, webhook } from "../../agent/events.js";
import { acceptProposal, forgetLine, listProposals, memoryEntries, rejectProposal } from "../../agent/memory.js";
import { listRoutines, readRoutine } from "../../agent/routine-files.js";
import { executeRoutine } from "../../agent/routines.js";
import { cancelSchedule, clockAdder, listSchedules, seedSchedules } from "../../agent/schedule.js";
import { applyOutcome, feedItem, feedProblem, runSource, sourceProblem } from "../../agent/feeds.js";
import { decide } from "../../agent/asks.js";
import { readPolicy, savePolicy, readApprovals } from "../../agent/approval-policy.js";
import { addInboxEntry, deleteInboxEntry, editInboxEntries, fileEntry } from "../../agent/inbox.js";
import { AgentDoc } from "../../agent/agent-doc.js";
import { emailView, setupEmail, patchEmail, removeEmail } from "../../agent/email-setup.js";
import { backgroundSubagents } from "../subagents.js";
import { workOps } from "../../durable-adapter.js";

/**
 * The hub's persistent agent over HTTP (docs/plans/persistent-agent.md).
 *
 * GET  /v0/agent                     the agent, its threads and its attention list
 * POST /v0/agent                     give this hub its agent { name? }
 * PATCH /v0/agent                    its settings (name, dial, budgetUsdPerDay, timezone, brief, heartbeat)
 * POST /v0/agent/asks/:id            decide an approval { choice }
 * GET  /v0/agent/policy              the standing approval policy and whether it is the starter
 * PUT  /v0/agent/policy              save approval rules { may?, always?, limits?, exact? }
 * GET  /v0/agent/approvals           approval audit records, newest first (?limit=)
 * POST /v0/agent/threads             a side thread { title? }
 * POST /v0/agent/wake                a run now { task, title? }
 * POST /v0/agent/feeds               add a feed { title, everyMinutes, source, level? } (feeds.js)
 * POST /v0/agent/feeds/test          run a source once { source }: { items, error? }; saves nothing
 * POST /v0/agent/feeds/:id/forget    forget items it has seen { ids? | latest? } (all without): its next check reports them as new
 * PATCH /v0/agent/feeds/:id          change its { title?, everyMinutes?, source?, level? }, keeping what it has seen
 * DELETE /v0/agent/feeds/:id         remove a feed
 * POST /v0/agent/schedules/:id/run   run one now, off its clock (testing): a routine's tasks gather and its run fires
 *                                    whatever its gate (not a gate of never), even in quiet hours; a feed checks; the rest wake a run
 * GET  /v0/agent/routines            its routine files (routines/*.md) with their cursors and last firing
 * POST /v0/agent/tasks/:id/retry       run a task the runtime parked (restart limit) again from its checkpoint
 * POST /v0/agent/routines/:name/test    its tasks once and the run's prompt and first message; moves nothing
 * POST /v0/agent/routines/:name/forget  forget what a task has seen { task, latest? } (all without): reported as new next time
 * GET  /v0/agent/messages           the jbot message log, newest last (?before=<id>&limit=)
 * GET  /v0/agent/work               each reply's work: the ops of the turn it ended (?ids=<log message ids>&full=1)
 * POST /v0/agent/messages           the person says something in the app { text }: logged first, then given to the home thread
 * POST /v0/agent/voice-message      a PCM WAV recording: transcribed, logged via voice, then given to the same home thread
 * POST /v0/agent/inbox              add context as the signed-in person { title, headline, body?, level, kind?, for? }
 * PATCH /v0/agent/inbox/:id         { action: handle|reopen|address|dismiss, outcome?, for? }
 * DELETE /v0/agent/inbox/:id        hard delete, person only
 * POST /v0/agent/feedback           feedback about a jbot app message { messageId, text }; returns { id }
 * POST /v0/agent/reset              start over: a new home thread, empty inbox; settings, memory and feeds stay
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
export function registerAgentRoutes(app, { agent, backends, hubId, voiceRuntime }) {
  const transcribeVoice = voiceTranscriber(voiceRuntime);
  const enabled = (response) => {
    if (agent.enabled()) return true;
    response.status(409).json({ error: "agent_not_enabled" });
    return false;
  };

  app.get("/v0/agent/policy", async (request, response, next) => {
    try {
      if (!enabled(response)) return;
      response.json(await readPolicy(agent));
    } catch (error) { next(error); }
  });

  app.put("/v0/agent/policy", async (request, response, next) => {
    try {
      if (!enabled(response)) return;
      response.json(await savePolicy(agent, request.body));
    } catch (error) {
      if (error.status === 400) return response.status(400).json({ error: error.message });
      next(error);
    }
  });

  app.get("/v0/agent/approvals", async (request, response, next) => {
    try {
      if (!enabled(response)) return;
      response.json({ records: await readApprovals(path.join(agent.runtime.dataRoot, "agent", "approvals"), request.query.limit) });
    } catch (error) { next(error); }
  });

  /**
   * What is under way and what needs the person. Working: its runs still going
   * and its clocks. Needs you: a question or approval waiting in one of its
   * threads, memory its runs proposed, and notices (a budget reached).
   */
  /*
   * Work the runtime parked after too many restarts (pi-durable's restart limit): nothing runs it again until someone
   * asks, so it is said here, with Retry (POST /v0/agent/tasks/:id/retry).
   */
  const TASK_WORDS = { "conduit.subagent-reporter": "A run's report", "conduit.agent-routine": "A routine", "pi.generation": "A model turn", "pi.tool": "A tool call" };
  const parkedTasks = async () => {
    const harness = await agent.runtime.open();
    // A harness that cannot inspect (or fails to) has nothing parked to say.
    const { tasks } = await Promise.resolve().then(() => harness.inspect(agent.context)).catch(() => ({ tasks: [] }));
    return tasks.filter((task) => task.state.kind === "blocked" && task.state.reason === "restart_limit").map((task) => ({
      id: `task-${task.record.id}`, kind: "parked", taskId: task.record.id, at: task.record.startedAt ? new Date(task.record.startedAt).toISOString() : null,
      text: `${TASK_WORDS[task.record.kind] || "A task"} stopped after restarting ${task.record.restarts ?? "too many"} times`,
    }));
  };
  const attention = async (view, state) => {
    const harness = await agent.runtime.open();
    const runs = view.home?.conversationId ? await backgroundSubagents(harness, view.home.conversationId, agent.context) : [];
    const threads = [view.home?.chatId, ...view.sides.map((side) => side.chatId)].filter(Boolean);
    const waiting = threads.flatMap((chatId) => (backends.getByChatId(chatId)?.hostUiRequests || [])
      .map((request) => ({ kind: "question", chatId, requestId: request.id, title: request.title || "A question" })));
    // A run waits on no one (it cannot ask); a thread whose chat is not live may still have a question pending.
    for (const thread of await Promise.all([...agent.runtime.askerWaits?.keys() || []].map((conversationId) => agent.describe(conversationId)))) {
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
        notices: [...state.notices, ...(agent.connectors.entry("executor").status === "on" ? [] : [{
          id: "connector-executor", kind: "connector", text: "Executor isn't connected", at: null,
        }]), ...await parkedTasks()],
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

  app.post("/v0/agent/inbox", async (request, response, next) => {
    try {
      if (!enabled(response)) return;
      const entry = await agent.update((doc, tx) => addInboxEntry(tx, request.body, { author: "person", by: "person" }));
      response.status(201).json(entry);
    } catch (error) {
      if ([400, 404].includes(error.status)) return response.status(error.status).json({ error: error.message });
      next(error);
    }
  });
  app.patch("/v0/agent/inbox/:id", async (request, response, next) => {
    try {
      if (!enabled(response)) return;
      const entry = await agent.update((doc) => editInboxEntries(doc, {
        action: request.body?.action, outcome: request.body?.outcome, for: request.body?.for, id: request.params.id,
      }, { by: "person" })[0]);
      response.json(entry);
    } catch (error) {
      if ([400, 404].includes(error.status)) return response.status(error.status).json({ error: error.message });
      next(error);
    }
  });
  app.delete("/v0/agent/inbox/:id", async (request, response, next) => {
    try {
      if (!enabled(response)) return;
      await agent.update((doc, tx) => deleteInboxEntry(tx, request.params.id));
      response.status(204).end();
    } catch (error) {
      if ([400, 404].includes(error.status)) return response.status(error.status).json({ error: error.message });
      next(error);
    }
  });

  app.post("/v0/agent/feedback", async (request, response, next) => {
    try {
      if (!enabled(response)) return;
      const { messageId, text: input } = request.body || {};
      const text = typeof input === "string" ? input.trim() : "";
      if (typeof messageId !== "string" || !messageId.trim() || !text || text.length > 2000) {
        return response.status(400).json({ error: "invalid_feedback" });
      }
      const message = agent.runtime.messageLog?.messages.find((item) => item.id === messageId
        && item.channel === "app" && item.direction === "out" && item.sender === "jbot");
      if (!message) return response.status(404).json({ error: "message_not_found" });
      const original = String(message.body || "").trim();
      const quote = original.length > 600 ? `${original.slice(0, 599)}…` : original;
      const key = `feedback:${crypto.randomUUID()}`;
      const id = await agent.update(async (doc, tx) => (await fileEntry(tx, {
        key, kind: "feedback", for: ["reflect"], level: "fyi", status: "unhandled",
        title: "Feedback", headline: text.split(/\r?\n/)[0], author: "person", via: "feedback", text, messageId,
        body: `${text}\n\nAbout jbot message ${message.id} at ${message.at}:\n${quote.split("\n").map((line) => `> ${line}`).join("\n")}`,
      })).id);
      response.status(201).json({ id });
    } catch (error) { next(error); }
  });

  const deliverMessage = async (text, via = "app", id = `in:${crypto.randomUUID()}`) => {
    const log = agent.runtime.messageLog;
    if (!log) throw Object.assign(new Error("The message log is not ready."), { status: 503 });
    const home = await agent.home();
    // Keep the authenticated app channel: person-words.js trusts its claimed entries.
    // Voice is the input method, not a new reply transport.
    const message = log.append({ id, at: new Date().toISOString(),
      channel: "app", via, direction: "in", sender: "person", body: text, conversationId: home.conversationId });
    agent.chatHost.say(home.chat.id, text).catch((error) => {
      log.update(message.id, () => ({ delivery: { state: "failed", at: new Date().toISOString(), error: error?.message || String(error) } }));
    });
    return message;
  };

  app.post("/v0/agent/messages", async (request, response, next) => {
    try {
      if (!enabled(response)) return;
      const text = typeof request.body?.text === "string" ? request.body.text.trim() : "";
      if (!agent.runtime.messageLog || !text) return response.status(400).json({ error: "Say something", code: "empty_message" });
      response.status(201).json({ message: await deliverMessage(text) });
    } catch (error) { next(error); }
  });

  const voiceRequests = new Map();
  // Global session authentication runs before agent routes. JSON middleware leaves audio/wav untouched.
  app.post("/v0/agent/voice-message", (request, response, next) => {
    if (!enabled(response)) return;
    if (!agent.active()) return response.status(409).json({ error: "agent_off" });
    if (!request.is("audio/wav")) return response.status(415).json({ error: "invalid_audio", message: "Send an audio/wav recording." });
    next();
  }, express.raw({ type: "audio/wav", limit: "10mb" }), async (request, response, next) => {
    try {
      const key = request.get("X-Conduit-Voice-Id");
      if (key && !/^[a-f0-9-]{36}$/i.test(key)) return response.status(400).json({ error: "invalid_voice_id" });
      const id = key ? `in:voice:${key}` : `in:${crypto.randomUUID()}`;
      // A lost HTTP reply must not turn the bubble's one retry into a second person message.
      const existing = agent.runtime.messageLog?.messages.find((message) => message.id === id);
      if (existing) return response.json({ text: existing.body });
      let delivery = voiceRequests.get(id);
      if (!delivery) {
        delivery = (async () => {
          const text = await transcribeVoice(request.body);
          // The dial can change while a cold local model transcribes the recording.
          if (!agent.enabled()) throw Object.assign(new Error("jbot is not enabled."), { status: 409, code: "agent_not_enabled" });
          if (!agent.active()) throw Object.assign(new Error("jbot is off."), { status: 409, code: "agent_off" });
          await deliverMessage(text, "voice", id);
          return text;
        })();
        voiceRequests.set(id, delivery);
      }
      try { response.json({ text: await delivery }); }
      finally { if (voiceRequests.get(id) === delivery) voiceRequests.delete(id); }
    } catch (error) {
      if (Number.isInteger(error.status) && error.status >= 400 && error.status < 600) {
        return response.status(error.status).json({ error: error.code || "voice_failed", message: error.message });
      }
      // A transcription provider's own failure: said plainly to the bubble, which shows it.
      console.error("[agent] voice message failed", error?.message || error);
      response.status(502).json({ error: "voice_failed", message: `Transcription failed: ${String(error?.message || error).slice(0, 120)}` });
    }
  });

  // Serialize local settings and remote setup so overlapping requests cannot replace each other's secret.
  let emailChanges = Promise.resolve();
  const emailChannel = () => agent.runtime.messageLog.channels.email;
  const changeEmail = (action) => {
    const result = emailChanges.then(action);
    emailChanges = result.catch(() => {});
    return result;
  };
  app.get("/v0/agent/email", (request, response) => {
    if (!enabled(response)) return;
    response.json(emailView(emailChannel()));
  });
  app.post("/v0/agent/email/setup", async (request, response) => {
    if (!enabled(response)) return;
    const result = await changeEmail(() => setupEmail({ channel: emailChannel(), hubId,
      token: request.body?.token, address: request.body?.address, person: request.body?.person, hubUrl: request.body?.hubUrl }));
    response.status(result.status).json({ steps: result.steps, email: result.email });
  });
  app.patch("/v0/agent/email", async (request, response, next) => {
    if (!enabled(response)) return;
    try { response.json(await changeEmail(() => patchEmail(emailChannel(), request.body))); }
    catch (error) {
      if (error.status === 400) return response.status(400).json({ error: error.message });
      next(error);
    }
  });
  app.post("/v0/agent/email/check", async (request, response) => {
    if (!enabled(response)) return;
    await changeEmail(() => emailChannel().poll({ check: true }).catch(() => {}));
    response.json(emailView(emailChannel()));
  });
  app.delete("/v0/agent/email", async (request, response) => {
    if (!enabled(response)) return;
    const result = await changeEmail(() => removeEmail({ channel: emailChannel(), token: request.body?.token }));
    response.status(result.status).json({ steps: result.steps, email: result.email });
  });

  // jbot's mailbox has mail (workers/jbot-mail): collect it now rather than at the next minute. The Worker proves itself
  // with the shared secret; the call carries no mail, so a wrong or replayed one costs a poll at most.
  app.post("/v0/agent/email/wake", (request, response) => {
    const email = agent.runtime.messageLog?.channels.email;
    if (!email?.ready || !email.authorizes(request.headers.authorization)) return response.status(404).json({ error: "not_found" });
    void email.poll().catch((error) => console.error("[agent] email collection failed", error?.message || error));
    response.status(202).json({ collecting: true });
  });

  app.get("/v0/agent/messages", (request, response) => {
    const log = agent.runtime.messageLog;
    const limit = Math.min(200, Math.max(1, Number(request.query.limit) || 50));
    response.json({ messages: log ? log.list({ before: request.query.before ? String(request.query.before) : null, limit }) : [] });
  });

  // A reply's work: each of jbot's replies (ids, its log messages) as the ops of the turn it ended, since the message
  // before it in its thread; lean unless full (workOps).
  app.get("/v0/agent/work", async (request, response, next) => {
    try {
      const log = agent.runtime.messageLog;
      const ids = String(request.query.ids || "").split(",").filter(Boolean).slice(0, 200);
      const harness = await agent.runtime.open();
      const work = {};
      for (const id of ids) {
        const message = log?.messages.find((item) => item.id === id);
        if (!message || message.direction !== "out" || message.entryId == null) continue;
        const before = log.messages.findLast((item) => item.entryId != null && item.entryId < message.entryId && String(item.conversationId) === String(message.conversationId));
        const from = before ? before.entryId + (before.direction === "out" ? 1 : 0) : 0;
        const conversation = await harness.conversation(Number(message.conversationId), agent.context);
        if (!conversation) continue;
        const entries = [];
        let cursor;
        do {
          const page = await conversation.entries({ order: "ascending", minEntryId: from, maxEntryId: message.entryId }, 500, cursor, agent.context);
          entries.push(...page.items);
          cursor = page.next;
        } while (cursor);
        work[id] = workOps(entries, from, message.entryId, { lean: !request.query.full });
      }
      response.json({ work });
    } catch (error) { next(error); }
  });

  app.get("/v0/agent", async (request, response, next) => {
    try {
      const state = agent.enabled() ? await agent.state() : null;
      const view = await agent.view(state);
      response.json({ ...view, connectors: agent.connectors.list(), ...(view.enabled ? { attention: await attention(view, state) } : {}) });
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
      if (!agent.active()) return response.status(409).json({ error: "agent_off" });
      const task = String(request.body?.task || "").trim();
      if (!task) return response.status(400).json({ error: "invalid_task" });
      const run = await agent.wake({ key: `manual:${crypto.randomUUID()}`, kind: "manual", title: String(request.body?.title || "").trim() || undefined, task });
      response.status(run ? 202 : 409).json(run ? { id: run.id, conversationId: run.child } : { error: "agent_over_budget" });
    } catch (error) { next(error); }
  });

  // The person adds a feed directly: they are who jbot's feeds would ask.
  let addClocked = null;
  app.post("/v0/agent/feeds", async (request, response, next) => {
    try {
      if (!enabled(response)) return;
      const body = { title: request.body?.title, everyMinutes: Number(request.body?.everyMinutes), source: request.body?.source, level: request.body?.level };
      const problem = feedProblem(body);
      if (problem) return response.status(400).json({ error: "invalid_feed", message: problem });
      const { conversationId } = await agent.home();
      const harness = await agent.runtime.open();
      const conversation = await harness.conversation(conversationId, agent.context);
      addClocked ||= clockAdder(agent.runtime);
      const id = await conversation.commit(async (tx) => {
        const doc = await tx.doc(AgentDoc);
        const item = feedItem(doc, body, "person");
        await addClocked(tx, doc, item, conversationId);
        return item.id;
      }, agent.context);
      response.status(201).json({ id });
    } catch (error) { next(error); }
  });
  app.post("/v0/agent/feeds/test", async (request, response, next) => {
    try {
      if (!enabled(response)) return;
      const problem = sourceProblem(request.body?.source);
      if (problem) return response.status(400).json({ error: "invalid_source", message: problem });
      response.json(await runSource(agent, request.body.source));
    } catch (error) { next(error); }
  });
  app.post("/v0/agent/feeds/:id/forget", async (request, response, next) => {
    try {
      if (!enabled(response)) return;
      const ids = Array.isArray(request.body?.ids) ? new Set(request.body.ids.map(String)) : null;
      const forgot = await agent.update((doc) => {
        const feed = doc.schedules[request.params.id]?.feed;
        if (!feed) return null;
        const before = feed.seen.length;
        // `latest`: the newest n (seen is kept newest first), to have a feed report its last few again.
        const latest = Number.isInteger(request.body?.latest) && request.body.latest > 0 ? request.body.latest : null;
        feed.seen = ids ? feed.seen.filter((id) => !ids.has(id)) : latest ? feed.seen.slice(latest) : [];
        return before - feed.seen.length;
      });
      if (forgot === null) return response.status(404).json({ error: "feed_not_found" });
      response.json({ forgot });
    } catch (error) { next(error); }
  });
  app.patch("/v0/agent/feeds/:id", async (request, response, next) => {
    try {
      if (!enabled(response)) return;
      const { title, everyMinutes, source, level } = request.body || {};
      const changed = await agent.update((doc) => {
        const item = doc.schedules[request.params.id];
        if (!item?.feed) return null;
        const next = { title: title ?? item.title, everyMinutes: everyMinutes ?? item.everyMinutes, source: source ?? item.feed.source };
        const problem = feedProblem(next);
        if (problem) return { problem };
        item.title = String(next.title).slice(0, 80);
        item.everyMinutes = next.everyMinutes;
        item.feed.source = next.source;
        if (["fyi", "attention", "urgent"].includes(level)) item.feed.level = level;
        item.feed.lastError = null;
        return { ok: true };
      });
      if (!changed) return response.status(404).json({ error: "feed_not_found" });
      if (changed.problem) return response.status(400).json({ error: changed.problem });
      response.json({ ok: true });
    } catch (error) { next(error); }
  });
  app.post("/v0/agent/schedules/:id/run", async (request, response, next) => {
    try {
      if (!enabled(response)) return;
      if (!agent.active()) return response.status(409).json({ error: "agent_off" });
      const state = await agent.state();
      // A routine without a clock (switched off, or started only by an event) runs by hand all the same.
      const routineId = /^r-([a-z0-9][a-z0-9-]*)$/.exec(request.params.id)?.[1];
      const schedule = state.schedules[request.params.id]
        || (routineId && await readRoutine(agent.folder, routineId).catch(() => null) ? { id: request.params.id, routine: routineId } : null);
      if (!schedule) return response.status(404).json({ error: "schedule_not_found" });
      const key = `now:${schedule.id}:${crypto.randomUUID()}`;
      if (schedule.feed && schedule.feed.source.kind !== "run") {
        const outcome = await runSource(agent, schedule.feed.source, { seen: schedule.feed.seen || [] });
        const fresh = await agent.update(async (doc, tx) => {
          const current = doc.schedules[schedule.id];
          if (!current?.feed) return 0;
          await applyOutcome(tx, current, outcome, new Date().toISOString());
          return outcome.error ? 0 : current.feed.lastCount;
        });
        return response.json({ checked: outcome.items.length, new: fresh, error: outcome.error || null });
      }
      if (schedule.routine) {
        const fired = await agent.fireRoutine(schedule.routine, key);
        if (fired.error) return response.status(fired.status || 409).json({ error: fired.error });
        return response.status(202).json(fired);
      }
      const task = schedule.feed ? schedule.feed.source.task : schedule.task;
      const run = await agent.wake({ key, kind: schedule.feed ? "feed" : "checkback", title: schedule.title, task });
      // Run while it was due (its clock late): this run is that slot's, so the clock does not run it again.
      if (run) await agent.update((doc) => {
        const current = doc.schedules[schedule.id];
        if (current?.nextAt && Date.parse(current.nextAt) <= Date.now()) current.lastAt = current.nextAt;
      });
      response.status(run ? 202 : 409).json(run ? { id: run.id, conversationId: run.child } : { error: "agent_over_budget" });
    } catch (error) { next(error); }
  });
  app.get("/v0/agent/routines", async (_request, response, next) => {
    try {
      if (!enabled(response)) return;
      const state = await agent.state();
      response.json({ routines: (await listRoutines(agent.folder)).map((routine) => ({ ...routine,
        cursors: state.cursors?.[routine.name] || {}, last: state.routineState?.[routine.name] || null,
        schedule: state.schedules[`r-${routine.name}`] ? { nextAt: state.schedules[`r-${routine.name}`].nextAt } : null })) });
    } catch (error) { next(error); }
  });
  app.post("/v0/agent/routines/:name/test", async (request, response, next) => {
    try {
      if (!enabled(response)) return;
      const routine = await readRoutine(agent.folder, request.params.name).catch((error) => ({ error: error.message }));
      if (!routine) return response.status(404).json({ error: "routine_not_found" });
      if (routine.error) return response.status(400).json({ error: routine.error });
      const state = await agent.state();
      const outcome = await executeRoutine(agent, routine, { cursors: state.cursors?.[routine.name] || {}, state, force: true });
      response.json({ tasks: outcome.tasks, fresh: outcome.fresh, run: outcome.run, instructions: outcome.instructions || null, message: outcome.message || null });
    } catch (error) { next(error); }
  });
  // A task the runtime parked after too many restarts (pi-durable's restart limit) runs again from its checkpoint.
  app.post("/v0/agent/tasks/:id/retry", async (request, response, next) => {
    try {
      if (!enabled(response)) return;
      const id = Number(request.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: "invalid_task" });
      const harness = await agent.runtime.open();
      await harness.retryTask(id, agent.context);
      response.json({ retried: id });
    } catch (error) { next(error); }
  });
  app.post("/v0/agent/routines/:name/forget", async (request, response, next) => {
    try {
      if (!enabled(response)) return;
      const { task, latest } = request.body || {};
      if (typeof task !== "string") return response.status(400).json({ error: "task is required" });
      const forgot = await agent.update((doc) => {
        const cursor = doc.cursors?.[request.params.name]?.[task];
        if (!cursor?.seen) return null;
        const before = cursor.seen.length;
        cursor.seen = Number.isInteger(latest) && latest > 0 ? cursor.seen.slice(latest) : [];
        return before - cursor.seen.length;
      });
      response.status(forgot === null ? 404 : 200).json(forgot === null ? { error: "cursor_not_found" } : { forgot });
    } catch (error) { next(error); }
  });
  /**
   * Start over: a new home thread, and an empty inbox and attention list. Its settings, memory files, feeds (with what
   * they have seen), schedules and saved approval rules stay; their clocks move to the new thread. The old home thread is
   * the caller's to delete (DELETE /v0/sessions/:id); its runs' chats go here.
   */
  app.post("/v0/agent/reset", async (request, response, next) => {
    try {
      if (!enabled(response)) return;
      const previous = (await agent.state()).home;
      await agent.update((doc) => {
        // Side threads outlive the reset, and what they read stays in them: only the old home thread's taint goes.
        const tainted = { ...doc.tainted };
        delete tainted[previous?.conversationId];
        Object.assign(doc, { home: null, inbox: {}, asks: {}, notices: [], proposals: {}, tainted });
        delete doc.beatLine; delete doc.heartbeatSeenAt; delete doc.heartbeatSweptAt;
      });
      const home = await agent.home();
      await seedSchedules(agent);
      let runs = 0;
      // listProject leaves run chats out; they are the agent project's subagent chats under any other thread.
      for (const chat of agent.registry.list({ includeHidden: true })) {
        if (chat.status !== "subagent" || chat.projectId !== agent.project.id || chat.backend?.parentChatId === home.chat.id) continue;
        await agent.registry.remove(chat.id, agent.project);
        runs++;
      }
      response.json({ previous: previous?.chatId || null, home: home.chat.id, runs });
    } catch (error) { next(error); }
  });

  app.delete("/v0/agent/feeds/:id", async (request, response, next) => {
    try {
      if (!enabled(response)) return;
      const item = (await agent.state()).schedules[request.params.id];
      if (!item?.feed) return response.status(404).json({ error: "feed_not_found" });
      await cancelSchedule(agent, request.params.id);
      response.status(204).end();
    } catch (error) { next(error); }
  });

  // The memory view: every line with its scope and provenance, and forgetting one exactly as it was shown.
  app.get("/v0/agent/memory", async (request, response, next) => {
    try {
      if (!enabled(response)) return;
      response.json({ entries: await memoryEntries(agent, { days: Math.min(60, Math.max(1, Number(request.query.days) || 14)) }) });
    } catch (error) { next(error); }
  });
  app.post("/v0/agent/memory/forget", async (request, response, next) => {
    try {
      if (!enabled(response)) return;
      const { file, date = null, line } = request.body || {};
      await forgetLine(agent, file, date, line);
      response.status(204).end();
    } catch (error) { if (error.status) return response.status(error.status).json({ error: error.message }); next(error); }
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
      // This notice reflects current status and remains until Executor connects.
      if (request.params.id === "connector-executor") return response.status(204).end();
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
      if (!agent.active()) return response.status(409).json({ error: "agent_off" });
      const run = await webhook(agent, request.params.token, request.body);
      // An unknown token says no more than a missing route would.
      response.status(run === null ? 404 : 202).json(run === null ? { error: "not_found" } : { accepted: true });
    } catch (error) { next(error); }
  });
}
