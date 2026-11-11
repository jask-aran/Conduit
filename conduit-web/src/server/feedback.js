import path from "node:path";
import { format } from "node:util";
import express from "express";
import { createFeedbackStore } from "./feedback-store.js";

/*
 * The hub as the feedback store's host: what it knew when an item was started, so the item carries the state the
 * comment is about, not the state at Send; and the store's routes behind the hub's sign-in.
 */
const RING = 200;
const CHAT_TAIL = 40;
const short = (value, length) => { const text = typeof value === "string" ? value : JSON.stringify(value) ?? ""; return text.length > length ? `${text.slice(0, length)}… (${text.length} characters)` : text; };

function brief(event) {
  const message = event.message || {};
  return {
    type: event.type, ...(event.op ? { op: event.op } : {}), ...(event.phase ? { phase: event.phase } : {}), ...(event.log?.seq ? { seq: event.log.seq } : {}),
    ...(event.generationId ? { generationId: event.generationId } : {}),
    ...(message.id || event.messageId ? { messageId: message.id || event.messageId } : {}), ...(message.role ? { role: message.role } : {}),
    ...(event.tool?.name || event.toolName ? { tool: event.tool?.name || event.toolName } : {}), ...(event.outcome ? { outcome: event.outcome } : {}),
    ...(event.code ? { code: event.code } : {}),
    ...(typeof (message.text ?? event.message) === "string" ? { text: short(message.text ?? event.message, 200) } : {}),
  };
}

export function createFeedback({ dataRoot, config, serverName, runtimeHub, uiControl, chatLogs, listProcesses }) {
  const logs = [];
  const events = [];
  const keep = (ring, entry) => { ring.push(entry); if (ring.length > RING) ring.splice(0, ring.length - RING); };

  // The hub's log is its stdout, which nothing else holds: its last lines are kept here as they are written.
  const restore = ["log", "info", "warn", "error"].map((level) => {
    const original = console[level];
    console[level] = (...args) => { keep(logs, { at: new Date().toISOString(), level, line: short(format(...args), 600) }); original.apply(console, args); };
    return () => { console[level] = original; };
  });
  chatLogs.tap = (chatId, event) => keep(events, { at: new Date().toISOString(), chatId, ...brief(event) });
  runtimeHub.tap = (event) => keep(events, { at: new Date().toISOString(), runtime: event.type,
    ...Object.fromEntries(Object.entries(event).filter(([key, value]) => key !== "type" && key !== "at" && ["string", "number", "boolean"].includes(typeof value)).slice(0, 8).map(([key, value]) => [key, short(value, 120)])),
    ...(event.process ? { chatId: event.process.chatId, status: event.process.status, activity: event.process.activity } : {}) });

  const store = createFeedbackStore({
    folder: path.join(dataRoot, "feedback"),
    about: ["`hub` is what the hub knew when the item was started (`markedAt`), not at Send: its last log lines and events, the live processes, and the tail of each chat the client had open."],
    log: (entry) => console.log(JSON.stringify({ ...entry, type: "conduit.feedback" })),
    async snapshot({ client, markedAt }) {
      const tabs = await uiControl.look().catch(() => []);
      const tab = tabs.find((candidate) => candidate.client === client) || null;
      const chats = (tab?.panes || []).map((pane) => /^chat:(.+)$/.exec(pane.view || "")?.[1]).filter(Boolean).map((chatId) => {
        const log = chatLogs.peek(chatId);
        return { chatId, log: log ? { ...log.state(), tail: log.entries.slice(-CHAT_TAIL).map(brief) } : null };
      });
      return { hub: {
        markedAt,
        server: { name: serverName, release: config.release, startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString() },
        client: tab,
        connections: runtimeHub.connections(),
        processes: listProcesses(),
        chats,
        logs: [...logs],
        events: [...events],
      } };
    },
  });
  return { ...store, close() { for (const undo of restore) undo(); chatLogs.tap = null; runtimeHub.tap = null; } };
}

/** Before the app's own JSON parser: an item's selections carry markup, so its body may be larger than a setting's. */
export function registerFeedbackRoutes(app, feedback) {
  app.post("/v0/feedback/marks", async (request, response) => response.status(201).json(await feedback.mark(request.body)));
  const png = express.raw({ type: "image/png", limit: "32mb" });
  app.put("/v0/feedback/marks/:id/screenshot", png, (request, response) => { feedback.picture(request.params.id, request.body); response.status(204).end(); });
  app.put("/v0/feedback/marks/:id/areas/:n", png, (request, response) => { feedback.picture(request.params.id, request.body, Number(request.params.n)); response.status(204).end(); });
  app.post("/v0/feedback/marks/:id/send", async (request, response) => response.status(201).json(await feedback.send(request.params.id, request.body)));
  app.get("/v0/feedback/waiting", async (_request, response) => response.json({ waiting: await feedback.waiting() }));
  app.delete("/v0/feedback/marks/:id", (request, response) => { feedback.drop(request.params.id); response.status(204).end(); });
  app.get("/v0/feedback/items", async (_request, response) => response.json({ items: await feedback.threads() }));
  app.get("/v0/feedback/items/:id", async (request, response) => response.json(await feedback.thread(request.params.id, { seen: "seen" in request.query })));
  app.post("/v0/feedback/items/:id/messages", async (request, response) => response.status(201).json(await feedback.say(request.params.id, request.body)));
}
