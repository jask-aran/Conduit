import { notice } from "../context/notices.js";
import { nextId } from "./agent-doc.js";
import { permissionChoices } from "../approval-api.js";

const HOUR24 = 86400_000;
const statusAt = (ask, now) => ask.status === "pending" && Date.parse(ask.expiresAt) <= now ? "expired" : ask.status;
/** The answers an ask offers: its permission's (approval-api.js), less Always where no lasting rule fits this call. An
 *  ask from before permissions were recorded offers what it did then. */
const choicesOf = (ask) => (ask.permission ? permissionChoices(ask.permission) : ["allow", "always", "deny"]).filter((choice) => choice !== "always" || Boolean(ask.ruleTarget));
function askView(ask, now = Date.now()) {
  const { id, chatId, toolCallId, parentCallId, title, service, lines, createdAt, expiresAt, decidedAt, choice } = ask;
  // A run's ask: the run's conversation, whose report it shows under.
  return { id, chatId, toolCallId, parentCallId, run: ask.run ? String(ask.sourceConversationId) : null, title, service, lines, createdAt, expiresAt,
    status: statusAt(ask, now), ...(ask.permission ? { permission: ask.permission } : {}), choices: choicesOf(ask),
    always: choicesOf(ask).includes("always") ? ask.ruleLabel ?? null : null, ...(decidedAt ? { decidedAt } : {}), ...(choice ? { choice } : {}) };
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
    if (!choicesOf(ask).includes(choice)) return { error: 400 };
    ask.status = choice === "deny" ? "declined" : "allowed";
    ask.decidedAt = now;
    ask.choice = choice;
    if (choice === "always") {
      const ruleId = nextId(doc, "r");
      doc.rules ||= {};
      doc.rules[ruleId] = { id: ruleId, tool: ask.tool, target: ask.ruleTarget, label: ask.ruleLabel, createdAt: now };
    }
    // Copied out: the doc's objects (an ask's lines) cannot be read once the commit settles.
    return { ask: JSON.parse(JSON.stringify(askView(ask))) };
  });
  if (outcome.error) throw Object.assign(new Error(outcome.error === 404 ? "Ask not found" : outcome.error === 400 ? "This approval does not offer that answer" : "Ask already decided or expired"), { status: outcome.error });
  const ask = outcome.ask;
  const told = await notice(agent.runtime?.contextStore, choice === "deny" ? "approval-denied" : "approval-allowed", { ask });
  // A run's ask outlives the run: the home thread is told whose it was, so its result is used for what the run was doing.
  const message = ask.run && choice !== "deny"
    ? `${told}\n\nOne of your runs asked for this and has since ended. Use the result for what that run was doing, and tell the person if it matters.`
    : told;
  // The decision stands even if the thread cannot be told now: an allowed call still goes through when it is made.
  try { await agent.chatHost.deliverApproval(ask.chatId, message); return { ...ask, delivered: true }; }
  catch (error) {
    console.warn(`[agent] could not tell its thread about ask ${ask.id}: ${error?.message || error}`);
    await agent.notice("approval", `Your answer to "${ask.title}" is saved, but ${agent.settings().name}'s thread could not be told. Tell it in the thread if it should act now.`);
    return { ...ask, delivered: false };
  }
}
