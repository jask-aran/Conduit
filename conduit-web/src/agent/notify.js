import { mintAnswerToken } from "./answer-tokens.js";

/**
 * What of the agent reaches the person's devices (docs/plans/persistent-agent.md, "Reaching you"): a run's report
 * that their interruption setting lets through, and a question waiting on their approval. Each goes to every device
 * that registered for push with this hub; a tap opens the thread it came from.
 */
const LEVEL_WORD = /^\s*(?:[*_`#>\s]*)(?:URGENT|ATTENTION|FYI|NOTHING)\b[*_`]*\s*[:.-]?\s*/i;
const line = (text, max) => {
  const flat = String(text || "").replace(LEVEL_WORD, "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** `runtime.agentNotify` for the durable runtime: called by the reporter and by approvals, never awaited by them. */
export function agentNotifier({ agent, push, hubId }) {
  return ({ kind, conversationId, title, text, level, key, always = false, waiting = 0, path = null }) => void (async () => {
    // The agent's threads, and any chat whose profile reaches the person's accounts (an approval it is waiting on).
    const thread = await agent.threadOf(conversationId);
    if (!thread?.chatId || thread.role === "run") return;
    const chat = thread.role === "chat";
    if (!chat && !agent.enabled()) return;
    if (chat && kind !== "approval") return;
    const name = chat ? thread.title || "A chat" : agent.settings().name;
    const urgent = level === "urgent";
    const approval = kind === "approval";
    const tag = String(key || `${kind}-${conversationId}`);
    // Nowhere to send it: say so where the person will look, once a day, rather than drop it without a word.
    if (!push.list().length) {
      const today = agent.today();
      if ((await agent.state()).notices.some((notice) => notice.kind === "push" && agent.today(Date.parse(notice.at)) === today)) return;
      await agent.notice("push", "A notification reached no device: turn notifications on in Settings on your phone.");
      return;
    }
    await push.send({
      v: 1,
      title: approval ? `${name} needs your approval` : `${title ? `${name}: ${line(title, 60)}` : name}${waiting ? ` · ${waiting} to approve` : ""}`,
      body: line(text, 240),
      // A message opens jbot's conversation (its page); an approval, the thread it waits in.
      path: path || (thread.role === "home" && !approval ? "/jbot" : `/chat/${thread.chatId}`),
      tag,
      hub: hubId(),
      ...(approval ? { answer: { token: mintAnswerToken(key), allow: "Allow", ...(always ? { always: "Always" } : {}), deny: "Don't" } } : {}),
      urgency: urgent || approval ? "high" : "normal",
    }, { urgency: urgent || approval ? "high" : "normal", topic: tag, ttl: approval ? 86400 : 43200 });
  })().catch((error) => console.warn("[agent] push:", error?.message || error));
}
