import { forkRecord } from "./routine-task.js";
import { NOT_SPOKEN } from "../transcript-fold.js";
import fs from "node:fs";
import path from "node:path";
import { defineTool } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";
import { headlineOf } from "./inbox.js";

/*
 * Ids are idempotency keys: a replayed tool or a republished entry writes nothing twice. A message out to another
 * channel keeps the destination worked out as it was written, so where it went never depends on later settings.
 */
const APP = { channel: "app", room: "app" };

export class MessageLog {
  constructor(file) {
    this.file = file;
    this.messages = [];
    this.ids = new Set();
    this.listeners = new Set();
    this.channels = {};
  }

  async load() {
    const text = await fs.promises.readFile(this.file, "utf8").catch((error) => error.code === "ENOENT" ? "" : Promise.reject(error));
    this.messages = text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
    this.ids = new Set(this.messages.map((message) => message.id));
    // Pending across a restart: the send was cut off at an unknown point, so whether it arrived is not known.
    const cut = this.messages.filter((message) => message.delivery?.state === "pending" && message.direction !== "in");
    for (const message of cut) message.delivery = { ...message.delivery, state: "uncertain", at: new Date().toISOString(), since: message.delivery.at };
    if (cut.length) this.persist();
    return this;
  }

  list({ before = null, limit = 50 } = {}) {
    const end = before ? this.messages.findIndex((message) => message.id === before) : this.messages.length;
    return this.messages.slice(Math.max(0, (end < 0 ? this.messages.length : end) - limit), end < 0 ? this.messages.length : end);
  }

  has(id) { return this.ids.has(id); }

  claim(text) {
    return this.messages.findLast((item) => item.direction === "in" && !item.entryId && (item.prompt === text || item.body === text) && Date.now() - Date.parse(item.at) < 10 * 60_000) || null;
  }

  replyRoom(conversationId, entryId) {
    const origin = this.messages.findLast((item) => item.direction === "in" && item.entryId != null && item.entryId < entryId && String(item.conversationId) === String(conversationId));
    if (!origin || origin.channel === "app") return APP;
    const channel = this.channels[origin.channel];
    return channel?.sends && channel.personOnly?.(origin.room) ? { channel: origin.channel, room: origin.room } : APP;
  }

  append(message) {
    if (this.ids.has(message.id)) return null;
    const away = message.direction === "out" && message.channel && message.channel !== "app";
    const channel = away ? this.channels[message.channel] : null;
    let destination = null;
    let unsent = null;
    if (away && !message.destination) {
      try { destination = channel ? channel.destination?.(message) || null : null; }
      catch (error) { unsent = error; }
    }
    // Its delivery starts here and only `held`, or `pending` for a message in, is the caller's to say; a delivery passed
    // for anything else is not kept.
    const { delivery: given, ...rest } = message;
    const delivery = away ? { state: "pending", at: message.at } : given?.state === "held" || (given?.state === "pending" && message.direction === "in") ? given : { state: "sent", at: message.at };
    const written = { ...APP, notify: "none", ...(destination ? { destination } : {}), ...rest, delivery };
    this.messages.push(written);
    this.ids.add(written.id);
    this.persist();
    for (const listener of this.listeners) listener({ type: "message", message: written });
    if (away) {
      void (unsent ? Promise.reject(unsent) : channel ? channel.send(written) : Promise.reject(new Error(`No ${written.channel} channel`)))
        .then((native) => this.update(written.id, () => ({ native, delivery: { state: "sent", at: new Date().toISOString() } })))
        .catch((error) => this.update(written.id, () => ({ delivery: { state: "failed", at: new Date().toISOString(), error: error?.message || String(error) } })));
    }
    return written;
  }

  update(id, change) {
    const message = this.messages.find((item) => item.id === id);
    if (!message) return null;
    Object.assign(message, change(message));
    this.persist();
    for (const listener of this.listeners) listener({ type: "message", message });
    return message;
  }

  persist() {
    // Whole file each change, written aside then moved: small, and never half-written.
    this.writing = (this.writing || Promise.resolve()).then(async () => {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      await fs.promises.writeFile(temporary, this.messages.map((message) => JSON.stringify(message)).join("\n") + "\n");
      await fs.promises.rename(temporary, this.file);
    }).catch((error) => console.error("[agent] message log not saved", error));
  }
}

/** A provider's label on a text part, read as durable-adapter reads it. */
const phaseOf = (part) => {
  if (!part?.textSignature?.startsWith("{")) return null;
  try { const phase = JSON.parse(part.textSignature)?.phase; return phase === "commentary" || phase === "final_answer" ? phase : null; } catch { return null; }
};
export function finalText(message) {
  const texts = (message?.content || []).filter((part) => part.type === "text" && part.text?.trim());
  const labelled = texts.length > 0 && texts.every((part) => phaseOf(part));
  const said = labelled ? texts.filter((part) => phaseOf(part) === "final_answer") : message?.stopReason === "toolUse" ? [] : texts;
  return said.map((part) => part.text).join("\n\n").trim();
}

export async function mirrorHomeThread(agent, log) {
  const harness = await agent.runtime.open();
  return harness.subscribeCommits((publication) => {
    const entries = publication.changes.filter((change) => change.type === "entry").map((change) => change.value)
      .filter((entry) => entry.kind === "conduit.user" || entry.kind === "pi.assistant");
    if (!entries.length) return;
    void agent.state().then((state) => {
      const home = state?.home?.conversationId;
      for (const entry of entries) {
        if (entry.conversationId !== home) continue;
        const at = entry.data?.timestamp || new Date(entry.createdAt || Date.now()).toISOString();
        if (entry.kind === "conduit.user") {
          const text = String(entry.data?.text || "").trim();
          const claimed = text && log.claim(text);
          if (claimed) log.update(claimed.id, () => ({ entryId: entry.id, conversationId: home }));
          else if (text && !NOT_SPOKEN.test(text)) log.append({ id: `in:${entry.data?.messageId || entry.id}`, at, direction: "in", sender: "person", body: text, conversationId: home, entryId: entry.id });
        } else {
          const body = finalText(entry.model?.[0]);
          const stamp = entry.model?.[0]?.timestamp ? new Date(entry.model[0].timestamp).toISOString() : at;
          if (body) log.append({ id: `final:${entry.id}`, at: stamp, ...log.replyRoom(home, entry.id), direction: "out", sender: "jbot", body, conversationId: home, entryId: entry.id });
        }
      }
    }).catch((error) => console.error("[agent] message log mirror", error));
  });
}

const result = (text, isError = false) => ({ output: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });

export function MessageTools(runtime) {
  const message = defineTool({
    name: "message",
    description: "Send the person a message. Your final text already reaches them in the app; use this to say something "
      + "mid-turn while you keep working (last: false), to send a report (give it a title: the app shows a card that opens "
      + "the whole of it), or to reach their phone (notify: push; urgent only for what cannot wait). With last: true (the "
      + "default) this message is your answer and your turn ends with it: never repeat it as final text.",
    parameters: Type.Object({
      text: Type.String({ description: "The message, Markdown. A report's whole body." }),
      title: Type.Optional(Type.String({ description: "Makes it a report: a few words naming it." })),
      notify: Type.Optional(Type.Union([Type.Literal("none"), Type.Literal("push"), Type.Literal("urgent")], { description: "Reach their phone too: push, or urgent for what cannot wait." })),
      last: Type.Optional(Type.Boolean({ description: "This message is your answer and ends your turn (default true); false to keep working." })),
      room: Type.Optional(Type.String({ description: "Where it goes: app (the default); an email room (email:…, given with each email) to reply in it; email for a new email to the person." })),
    }),
    replay: "unsafe",
    execute: async ({ text, title, notify = "none", last = true, room = "app" }, api, context) => {
      const role = (await runtime.agent?.describe(api.conversationId))?.role;
      if (role !== "home") return result("Only jbot's home thread messages the person; a run reports to jbot.", true);
      if (!String(text || "").trim()) return result("Say something: the message is empty.", true);
      const log = runtime.messageLog;
      if (!log) return result("The message log is not ready; say it as your final text instead.", true);
      const email = log.channels.email;
      const channel = room === "app" ? "app" : room === "email" || room.startsWith("email:") ? "email" : null;
      if (!channel) return result(`No room "${room}": write to app, an email room, or email.`, true);
      if (channel === "email" && !email?.sends) return result("You do not send email: say it in the app (room app) instead.", true);
      if (room.startsWith("email:") && !log.messages.some((item) => item.room === room)) return result(`No email room ${room}.`, true);
      if (room.startsWith("email:") && !email.personOnly(room)) return result("Not sent: that email has someone other than the person in it, and your address writes only to the person. If they want it answered, offer to send it from their own Gmail (Executor), which asks their approval; never say it was sent.", true);
      if (forkRecord(await runtime.agent?.state(), api.conversationId)) return result("Routine forks cannot message the person.", true);
      const at = await api.memo("at", new Date().toISOString(), context);
      const id = `tool:${api.taskId}`;
      // A replay finds it written (the id is its key) and neither writes nor pushes it again.
      const written = log.append({ id, at, channel, room, direction: "out", sender: "jbot", ...(title ? { title } : {}), body: text, notify, conversationId: api.conversationId });
      let pushed = null;
      if (written && notify !== "none") {
        // Which devices it reached, kept on the message for the app to say ("Sent to Phone").
        pushed = await runtime.agentNotify?.({ kind: "report", conversationId: api.conversationId, title: title || headlineOf(text, 60), text, level: notify === "urgent" ? "urgent" : "attention", key: id, path: "/jbot" }) || null;
        if (pushed) log.update(id, () => ({ pushed }));
      }
      const reached = pushed?.to.length ? ` and to ${pushed.to.join(", ")}` : notify !== "none" ? " (no device took the push)" : "";
      const said = title ? `Sent the report "${title}" in the app${reached}.` : `Sent in the app${reached}.`;
      return last ? { ...result(said), control: { terminate: true } } : result(said);
    },
  });
  return { tools: [message] };
}
