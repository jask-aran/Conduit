import fs from "node:fs";
import path from "node:path";
import { defineTool } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";
import { headlineOf } from "./inbox.js";

/*
 * The jbot message log (docs/plans/persistent-agent.md, "Talking to the person"): what the person and jbot say to
 * each other, apart from jbot's thread, which is its working record. Every turn's final text is a message, to the room
 * its turn came from; the `message` tool says what final text cannot (speak first, a report, notify). Only the app
 * room exists yet.
 *
 * A message: `{ id, at, channel, room, direction: "in" | "out", sender: "person" | "jbot", title?, body,
 * notify: "none" | "push" | "urgent", delivery: { state: "pending" | "sent" | "failed" | "uncertain", at },
 * conversationId, entryId? }`. Ids are idempotency keys: a replayed tool or a republished entry writes nothing twice.
 * The app room is delivered the moment it is written.
 */
const APP = { channel: "app", room: "app" };
// Prompts Conduit writes into the thread in the person's name that are not the person speaking.
const NOT_SPOKEN = /^(?:\[Approval\]|The user stopped your previous response|It is |Since this thread began:)/i;

export class MessageLog {
  constructor(file) {
    this.file = file;
    this.messages = [];
    this.ids = new Set();
    this.listeners = new Set();
  }

  async load() {
    const text = await fs.promises.readFile(this.file, "utf8").catch((error) => error.code === "ENOENT" ? "" : Promise.reject(error));
    this.messages = text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
    this.ids = new Set(this.messages.map((message) => message.id));
    return this;
  }

  /** Newest last; `before` an id to page back from. */
  list({ before = null, limit = 50 } = {}) {
    const end = before ? this.messages.findIndex((message) => message.id === before) : this.messages.length;
    return this.messages.slice(Math.max(0, (end < 0 ? this.messages.length : end) - limit), end < 0 ? this.messages.length : end);
  }

  has(id) { return this.ids.has(id); }

  /** The person's message written here before it reached the thread (log first): the thread's copy of it is this one. */
  claim(text) {
    return this.messages.findLast((item) => item.direction === "in" && !item.entryId && item.body === text && Date.now() - Date.parse(item.at) < 10 * 60_000) || null;
  }

  append(message) {
    if (this.ids.has(message.id)) return null;
    const written = { ...APP, notify: "none", delivery: { state: "sent", at: message.at }, ...message };
    this.messages.push(written);
    this.ids.add(written.id);
    this.persist();
    for (const listener of this.listeners) listener({ type: "message", message: written });
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

  /** The last thing jbot said from this conversation, within the last few minutes: what a notify call is about. */
  latestOut(conversationId, withinMs = 10 * 60_000) {
    const message = this.messages.findLast((item) => item.direction === "out" && String(item.conversationId) === String(conversationId));
    return message && Date.now() - Date.parse(message.at) <= withinMs ? message : null;
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

/** A provider's label on a text part (pi-ai's TextSignatureV1), as durable-adapter reads it. */
const phaseOf = (part) => {
  if (!part?.textSignature?.startsWith("{")) return null;
  try { const phase = JSON.parse(part.textSignature)?.phase; return phase === "commentary" || phase === "final_answer" ? phase : null; } catch { return null; }
};
/** What of an assistant message is said to the person: its final answer, not commentary on the way. */
export function finalText(message) {
  const texts = (message?.content || []).filter((part) => part.type === "text" && part.text?.trim());
  const labelled = texts.length > 0 && texts.every((part) => phaseOf(part));
  const said = labelled ? texts.filter((part) => phaseOf(part) === "final_answer") : message?.stopReason === "toolUse" ? [] : texts;
  return said.map((part) => part.text).join("\n\n").trim();
}

/** Mirrors jbot's home thread into the log as it is written: the person's prompts in, every final answer out. */
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
          if (body) log.append({ id: `final:${entry.id}`, at: stamp, direction: "out", sender: "jbot", body, conversationId: home, entryId: entry.id });
        }
      }
    }).catch((error) => console.error("[agent] message log mirror", error));
  });
}

const result = (text, isError = false) => ({ content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });

/** The `message` tool: jbot speaking to the person beyond its final text. */
export function MessageTools(runtime) {
  const message = defineTool({
    name: "message",
    description: "Send the person a message in the app. Your final text already reaches them; use this to speak when no "
      + "final text would (mid-turn, while you keep working), to send a report (give it a title: the app shows it as a card "
      + "that opens the full Markdown), or to notify their phone (notify: push; urgent only for what cannot wait). Never "
      + "repeat in your final text what you sent this way.",
    parameters: Type.Object({
      text: Type.String({ description: "The message, Markdown. A report's whole body." }),
      title: Type.Optional(Type.String({ description: "Makes it a report: a few words naming it." })),
      notify: Type.Optional(Type.Union([Type.Literal("none"), Type.Literal("push"), Type.Literal("urgent")])),
    }),
    replay: "unsafe",
    execute: async ({ text, title, notify = "none" }, api, context) => {
      const role = (await runtime.agent?.describe(api.conversationId))?.role;
      if (role !== "home") return result("Only jbot's home thread messages the person; a run reports to jbot.", true);
      const log = runtime.messageLog;
      if (!log) return result("The message log is not ready.", true);
      const at = await api.memo("at", new Date().toISOString(), context);
      const id = `tool:${api.taskId}`;
      const written = log.append({ id, at, direction: "out", sender: "jbot", ...(title ? { title } : {}), body: text, notify, conversationId: api.conversationId });
      if (written && notify !== "none") {
        runtime.agentNotify?.({ kind: "report", conversationId: api.conversationId, title: title || headlineOf(text, 60), text, level: notify === "urgent" ? "urgent" : "attention", key: id });
      }
      return result(title ? `Sent the report "${title}".` : "Sent.");
    },
  });
  return { tools: [message] };
}
