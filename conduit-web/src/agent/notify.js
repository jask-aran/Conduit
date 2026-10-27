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

/** `runtime.notify` for the durable runtime: called by the reporter and by approvals, never awaited by them. */
export function agentNotifier({ agent, push, hubId }) {
  return ({ kind, conversationId, title, text, level, key }) => void (async () => {
    if (!agent.enabled()) return;
    const thread = await agent.describe(conversationId);
    if (!thread?.chatId || thread.role === "run") return;
    const name = agent.settings().name;
    const urgent = level === "urgent";
    const approval = kind === "approval";
    const tag = String(key || `${kind}-${conversationId}`);
    await push.send({
      v: 1,
      title: approval ? `${name} needs your approval` : title ? `${name}: ${line(title, 60)}` : name,
      body: line(text, 240),
      path: `/chat/${thread.chatId}`,
      tag,
      hub: hubId(),
      urgency: urgent || approval ? "high" : "normal",
    }, { urgency: urgent || approval ? "high" : "normal", topic: tag, ttl: approval ? 86400 : 43200 });
  })().catch((error) => console.warn("[agent] push:", error?.message || error));
}
