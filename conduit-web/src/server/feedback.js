import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { format } from "node:util";
import express from "express";

/*
 * UI feedback (client/feedback/feedback-tool.tsx): the person marks up Conduit's own interface on a development
 * client and sends it to whoever works on Conduit.
 *
 * The mark: when a feedback item is started the client says "this moment", and the hub keeps what it knew then --
 * its recent log lines and events (kept here in short rings, since nothing else holds them), the live processes, the
 * connections, the client's panes and the tail of each chat it shows -- so the item carries the state the comment is
 * about, not the state at Send.
 *
 * The item: Send writes <data>/feedback/<id>/item.json and screenshot.png, built in a folder beside it and renamed
 * into place, so a reader never sees half of one. `node scripts/conduit-feedback.mjs wait` hands the next item to
 * an agent session; `done <id>` marks it handled.
 *
 *   POST   /v0/feedback/marks                  { client }            -> { id }
 *   PUT    /v0/feedback/marks/:id/screenshot   image/png
 *   POST   /v0/feedback/marks/:id/send         { comments, screenshot, client } -> { id, path }
 *   DELETE /v0/feedback/marks/:id              a mark nothing was sent to
 */
const RING = 200;
const CHAT_TAIL = 40;
const MARKS = 12;
const MARK_MS = 6 * 60 * 60_000;
const short = (value, length) => { const text = typeof value === "string" ? value : JSON.stringify(value) ?? ""; return text.length > length ? `${text.slice(0, length)}… (${text.length} characters)` : text; };

/** A record event in one line's worth: what it was and to what, its text cut short. */
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
  const folder = path.join(dataRoot, "feedback");
  const logs = [];
  const events = [];
  const marks = new Map();
  const keep = (ring, entry) => { ring.push(entry); if (ring.length > RING) ring.splice(0, ring.length - RING); };

  // The hub's log is its stdout; the last lines of it are kept here as they are written.
  const restore = ["log", "info", "warn", "error"].map((level) => {
    const original = console[level];
    console[level] = (...args) => { keep(logs, { at: new Date().toISOString(), level, line: short(format(...args), 600) }); original.apply(console, args); };
    return () => { console[level] = original; };
  });
  // Every record a chat's log numbers, and every event told to all clients, in the order they happened.
  chatLogs.tap = (chatId, event) => keep(events, { at: new Date().toISOString(), chatId, ...brief(event) });
  // A runtime event: its plain fields (which chat, which project, why), and a process's state when it carries one.
  runtimeHub.tap = (event) => keep(events, { at: new Date().toISOString(), runtime: event.type,
    ...Object.fromEntries(Object.entries(event).filter(([key, value]) => key !== "type" && key !== "at" && ["string", "number", "boolean"].includes(typeof value)).slice(0, 8).map(([key, value]) => [key, short(value, 120)])),
    ...(event.process ? { chatId: event.process.chatId, status: event.process.status, activity: event.process.activity } : {}) });

  async function mark({ client } = {}) {
    for (const [id, kept] of marks) if (Date.now() - kept.time > MARK_MS) marks.delete(id);
    while (marks.size >= MARKS) marks.delete(marks.keys().next().value);
    const now = new Date();
    const id = `${now.toISOString().replace(/[-:T]/g, "").slice(0, 14).replace(/^(\d{8})/, "$1-")}-${randomBytes(2).toString("hex")}`;
    const tabs = await uiControl.look().catch(() => []);
    const tab = tabs.find((candidate) => candidate.client === client) || null;
    const chats = (tab?.panes || []).map((pane) => /^chat:(.+)$/.exec(pane.view || "")?.[1]).filter(Boolean).map((chatId) => {
      const log = chatLogs.peek(chatId);
      return { chatId, log: log ? { ...log.state(), tail: log.entries.slice(-CHAT_TAIL).map(brief) } : null };
    });
    marks.set(id, { time: now.getTime(), screenshot: null, snapshot: {
      markedAt: now.toISOString(),
      server: { name: serverName, release: config.release, startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString() },
      client: tab,
      connections: runtimeHub.connections(),
      processes: listProcesses(),
      chats,
      logs: [...logs],
      events: [...events],
    } });
    return { id };
  }

  /** One comment as the item states it: where the code is first, then what was on the page. */
  function comment(entry, scale) {
    const where = (described) => ({
      component: described.component ?? null, source: described.source ?? null, styles: described.styles ?? [],
      ...(described.orComponent ? { orComponent: described.orComponent } : {}), ...(described.maybeDrawnBy ? { maybeDrawnBy: described.maybeDrawnBy } : {}),
      within: described.within ?? [], anchors: described.anchors ?? {}, ...(described.regionSource ? { regionSource: described.regionSource } : {}),
      label: described.label ?? "", domPath: described.domPath ?? "", classes: described.classes ?? [], attributes: described.attributes ?? {}, rect: described.rect ?? null, html: short(described.html ?? "", 2400),
    });
    const rect = entry.rect ?? null;
    return {
      n: entry.n, comment: String(entry.comment ?? ""), kind: entry.kind === "group" ? "group" : "component", name: String(entry.name ?? ""), rect,
      ...(rect && scale ? { screenshotRect: Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, Math.round(value * scale)])) } : {}),
      ...(entry.kind === "group" ? { members: (entry.members ?? []).slice(0, 40).map(where) } : where(entry)),
    };
  }

  async function send(id, body) {
    const kept = marks.get(id);
    if (!kept) throw Object.assign(new Error("That feedback mark has gone; start the item again"), { status: 404, code: "feedback_mark_gone" });
    if (!Array.isArray(body?.comments) || !body.comments.length) throw Object.assign(new Error("A feedback item needs a comment"), { status: 400, code: "feedback_empty" });
    const client = body.client ?? {};
    const shot = kept.screenshot && body.screenshot?.width ? body.screenshot : null;
    // The picture is the page alone when it has the page's shape (a browser's tab; a window with no frame of its own): then a box on the page is a box in it.
    const viewport = client.viewport ?? {};
    const exact = Boolean(shot && viewport.width && Math.abs(shot.width / shot.height - viewport.width / viewport.height) < 0.01);
    const scale = exact ? shot.width / viewport.width : null;
    const sentAt = new Date().toISOString();
    const item = {
      schema: "conduit.feedback/1",
      id,
      summary: `${body.comments.length} ${body.comments.length === 1 ? "comment" : "comments"} on Conduit's interface, from the ${client.kind ?? "unknown"} client at ${client.url ?? "?"}`,
      read: [
        "Each entry of `comments` is one thing the person asked for, about one selection of the live interface.",
        "`source` is where that library piece is declared and `styles` where its CSS rules start; paths are from the repository root. `within` is the pieces it sits in, outermost first. `regionSource` is where the app writes the region it is in; to find the app code that drew this instance, search conduit-web/src/client for `label` or an attribute in `attributes`.",
        "A group's `members` are each described the same way. `rect` is in CSS pixels of the client's viewport; `screenshotRect` is the same box in screenshot.png, present only when the picture is the page alone.",
        "screenshot.png shows the page at Send with each selection outlined and numbered as `n`.",
        "`hub` is what the hub knew when the item was started (`markedAt`), not at Send: its last log lines and events, the live processes, and the tail of each chat the client had open.",
        `When the item is dealt with: node scripts/conduit-feedback.mjs done ${id}`,
      ],
      markedAt: kept.snapshot.markedAt,
      sentAt,
      comments: body.comments.slice(0, 50).map((entry) => comment(entry, scale)),
      screenshot: shot ? { file: "screenshot.png", width: shot.width, height: shot.height, surface: shot.surface ?? "unknown", outlined: true, pageOnly: exact, ...(scale ? { scale } : {}) }
        : { file: null, missing: String(body.screenshot?.missing ?? "not sent") },
      client: { id: client.id ?? null, kind: client.kind ?? null, build: client.build ?? null, shell: client.shell ?? null, url: client.url ?? null, viewport, interfaceSize: client.interfaceSize ?? null, userAgent: short(client.userAgent ?? "", 300) },
      hub: kept.snapshot,
    };
    const staging = path.join(folder, `.${id}.partial`);
    const final = path.join(folder, id);
    await fs.mkdir(staging, { recursive: true, mode: 0o700 });
    if (shot) await fs.writeFile(path.join(staging, "screenshot.png"), kept.screenshot);
    await fs.writeFile(path.join(staging, "item.json"), `${JSON.stringify(item, null, 2)}\n`);
    await fs.rename(staging, final);
    marks.delete(id);
    console.log(JSON.stringify({ type: "conduit.feedback", id, comments: item.comments.length, screenshot: Boolean(shot) }));
    return { id, path: path.join(final, "item.json") };
  }

  return {
    mark, send,
    screenshot(id, bytes) {
      const kept = marks.get(id);
      if (!kept) throw Object.assign(new Error("That feedback mark has gone; start the item again"), { status: 404, code: "feedback_mark_gone" });
      // A PNG, by its signature.
      if (!Buffer.isBuffer(bytes) || bytes.length < 8 || bytes.readUInt32BE(0) !== 0x89504e47) throw Object.assign(new Error("A screenshot is a PNG"), { status: 415, code: "feedback_screenshot_invalid" });
      kept.screenshot = bytes;
    },
    drop: (id) => marks.delete(id),
    close() { for (const undo of restore) undo(); chatLogs.tap = null; runtimeHub.tap = null; },
  };
}

/** Before the app's own JSON parser: an item's selections carry markup, so its body may be larger than a setting's. */
export function registerFeedbackRoutes(app, feedback) {
  app.post("/v0/feedback/marks", async (request, response) => response.status(201).json(await feedback.mark(request.body)));
  app.put("/v0/feedback/marks/:id/screenshot", express.raw({ type: "image/png", limit: "32mb" }), (request, response) => { feedback.screenshot(request.params.id, request.body); response.status(204).end(); });
  app.post("/v0/feedback/marks/:id/send", async (request, response) => response.status(201).json(await feedback.send(request.params.id, request.body)));
  app.delete("/v0/feedback/marks/:id", (request, response) => { feedback.drop(request.params.id); response.status(204).end(); });
}
