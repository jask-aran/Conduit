import { nextId } from "./agent-doc.js";

const HOUR24 = 86400_000;
const statusAt = (ask, now) => ask.status === "pending" && Date.parse(ask.expiresAt) <= now ? "expired" : ask.status;
export function askView(ask, now = Date.now()) {
  const { id, chatId, toolCallId, parentCallId, title, service, lines, createdAt, expiresAt, decidedAt, choice } = ask;
  // A run's ask: the run's conversation, whose report it shows under.
  return { id, chatId, toolCallId, parentCallId, run: ask.run ? String(ask.sourceConversationId) : null, title, service, lines, createdAt, expiresAt,
    status: statusAt(ask, now), always: ask.ruleTarget ? ask.ruleLabel ?? null : null, ...(decidedAt ? { decidedAt } : {}), ...(choice ? { choice } : {}) };
}
export function listAsks(state) {
  const now = Date.now();
  return Object.values(state.asks || {}).map((ask) => askView(ask, now))
    .filter((ask) => ask.status === "pending" || (ask.decidedAt && Date.parse(ask.decidedAt) > now - HOUR24))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function decide(agent, id, choice) {
  if (!["allow", "always", "deny"].includes(choice)) throw Object.assign(new Error("Invalid choice"), { status: 400 });
  const now = new Date().toISOString();
  const outcome = await agent.update((doc) => {
    const ask = doc.asks?.[id];
    if (!ask) return { error: 404 };
    if (ask.status === "pending" && ask.expiresAt <= now) ask.status = "expired";
    if (ask.status !== "pending") return { error: 409 };
    if (choice === "always" && !ask.ruleTarget) return { error: 400 };
    ask.status = choice === "deny" ? "declined" : "allowed";
    ask.decidedAt = now;
    ask.choice = choice;
    if (choice === "always") {
      const ruleId = nextId(doc, "r");
      (doc.rules ||= {})[ruleId] = { id: ruleId, tool: ask.tool, target: ask.ruleTarget, label: ask.ruleLabel, createdAt: now };
    }
    return { ask: askView(ask) };
  });
  if (outcome.error) throw Object.assign(new Error(outcome.error === 404 ? "Ask not found" : outcome.error === 400 ? "This approval has no reusable rule" : "Ask already decided or expired"), { status: outcome.error });
  const ask = outcome.ask;
  const message = choice === "deny" ? `[Approval] Not allowed: ${ask.title} (ask ${ask.id}). Do not do it; say so if it matters.`
    : `[Approval] Allowed: ${ask.title} (ask ${ask.id}). Do it now: call \`approved\` with ask ${ask.id}.`;
  // The decision stands even if the thread cannot be told now: an allowed call still goes through when it is made.
  try { await agent.chatHost.deliverApproval(ask.chatId, message); return { ...ask, delivered: true }; }
  catch (error) {
    console.warn(`[agent] could not tell its thread about ask ${ask.id}: ${error?.message || error}`);
    await agent.notice("approval", `Your answer to "${ask.title}" is saved, but ${agent.settings().name}'s thread could not be told. Tell it in the thread if it should act now.`);
    return { ...ask, delivered: false };
  }
}
