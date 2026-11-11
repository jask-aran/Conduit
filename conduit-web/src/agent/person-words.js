import { parseAttachmentEnvelope } from "../attachment-envelope.js";
import { statusAt } from "./asks.js";

/** Trusted intent only; ambiguous conduit.user entries are omitted. */
export async function personWords(agent, conversationId, { messages = 20, chars = 1200 } = {}) {
  const state = await agent.state();
  const thread = await agent.describe(conversationId);
  const source = thread?.role === "run" ? state.home?.conversationId : conversationId;
  const now = Date.now();
  const answers = Object.values(state.asks || {})
    .filter((ask) => ["allowed", "declined", "used"].includes(statusAt(ask, now))
      && ["allow", "always", "deny"].includes(ask.choice) && typeof ask.title === "string"
      && Date.parse(ask.decidedAt) >= now - 30 * 86400_000 && Date.parse(ask.decidedAt) <= now)
    .sort((a, b) => Date.parse(b.decidedAt) - Date.parse(a.decidedAt)).slice(0, 20)
    .map((ask) => ({ action: ask.title, choice: ask.choice === "deny" ? "deny" : "allow", at: ask.decidedAt }));
  const words = { messages: [], answers };
  messages = Number.isSafeInteger(messages) && messages >= 0 ? messages : 20;
  chars = Number.isSafeInteger(chars) && chars >= 0 ? chars : 1200;
  if (!source || !messages) return words;

  /*
   * Only channels that prove the person wrote them: an app message logged before it reached the thread, a thread entry
   * whose `author: "person"` only the server's client-command path stamps, or mail the receiving server proved. The
   * mirror's own `in:${messageId}` rows are not proof: it labels generated prompts as person messages too.
   */
  const typed = new Map((agent.runtime.messageLog?.messages || [])
    .filter((message) => message.channel === "app" && message.direction === "in" && message.sender === "person"
      && String(message.conversationId) === String(source) && message.entryId != null)
    .map((message) => [message.entryId, message]));
  const found = [];
  for (const message of [...(agent.runtime.messageLog?.messages || [])].reverse()) {
    if (found.length >= messages) break;
    if (message.channel !== "email" || message.direction !== "in" || message.sender !== "person" || message.native?.authenticated !== true) continue;
    if (String(message.conversationId) !== String(source)) continue;
    const text = String(message.body || "").trim();
    if (text) found.push({ text: `${message.title ? `${message.title}: ` : ""}${text}`.slice(0, chars), at: message.at, via: "email" });
  }
  const harness = await agent.runtime.open();
  let cursor;
  do {
    const page = await harness.commit((tx) => tx.scanEntries({ conversationId: source }, 100, cursor), agent.context);
    for (const entry of page.items) {
      if (entry.kind !== "conduit.user" || typeof entry.data?.text !== "string") continue;
      const message = typed.get(entry.id);
      const fromApp = message && message.id !== `in:${entry.data.messageId || entry.id}` && message.body === entry.data.text;
      if (!fromApp && entry.data.author !== "person") continue;
      // data.text preserves typed input; model content can contain expanded commands, images and context sections.
      const text = parseAttachmentEnvelope(entry.data.text).message;
      if (!text.trim()) continue;
      found.push({ text: text.slice(0, chars), at: entry.data.timestamp || message?.at, via: fromApp ? "app" : "thread" });
      if (found.length >= messages) break;
    }
    cursor = page.next;
  } while (cursor && found.filter((item) => item.via !== "email").length < messages);
  words.messages = found.sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0)).slice(0, messages);
  // No task: spawnRun persists runBrief's rendered wake-run notice, not the raw person's task. Templates are editable,
  // so even origin.kind === "manual" cannot recover their words reliably. Other origins are never person input.
  return words;
}
