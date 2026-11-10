import { notice } from "../context/notices.js";
import { nextId } from "./agent-doc.js";
import { permissionChoices } from "../approval-api.js";

const HOUR24 = 86400_000;
const WEEK = 7 * HOUR24;

/*
 * An ask's lifecycle, the one place that reads or moves its status: pending → allowed | declined | expired (the person
 * answered, or a day passed without an answer); allowed → used (its one call was made). Expiry is worked out when read,
 * not swept: a pending ask past its expiresAt is expired, so nothing has to write it, and one an older hub wrote as
 * "expired" still reads so. Everything else reads `statusAt` and moves an ask with `transition`.
 */
const MOVES = { pending: ["allowed", "declined", "expired"], allowed: ["used"] };
const ms = (now) => (typeof now === "number" ? now : now instanceof Date ? now.getTime() : Date.parse(now));
/** An ask's status at `now` (ms, a Date or an ISO string). */
export const statusAt = (ask, now = Date.now()) => ask.status === "pending" && Date.parse(ask.expiresAt) <= ms(now) ? "expired" : ask.status;
/** The fields a new ask starts with: pending, for a day. */
export const opened = (now = new Date()) => ({ createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + HOUR24).toISOString(), status: "pending" });
/**
 * Moves an ask to `to`, or returns false when the move is not one its lifecycle has (it was already decided, it
 * expired, it was used). An answer records when and which; a use records the call that used it, so a replay of that
 * call is known for what it is.
 */
export function transition(ask, to, { now = new Date(), choice, callId } = {}) {
  if (!MOVES[statusAt(ask, now)]?.includes(to)) return false;
  ask.status = to;
  if (to === "allowed" || to === "declined") { ask.decidedAt = new Date(ms(now)).toISOString(); ask.choice = choice; }
  if (to === "used") ask.usedCallId = callId;
  return true;
}
/** Settled (declined, expired or used) for a week: nothing reads it any more. An allowed ask is never pruned. */
export const prunable = (ask, now = Date.now()) => ["declined", "expired", "used"].includes(statusAt(ask, now)) && Date.parse(ask.decidedAt || ask.createdAt) < ms(now) - WEEK;
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
  const now = new Date();
  const outcome = await agent.update((doc) => {
    const ask = doc.asks?.[id];
    if (!ask) return { error: 404 };
    if (statusAt(ask, now) !== "pending") return { error: 409 };
    if (!choicesOf(ask).includes(choice)) return { error: 400 };
    transition(ask, choice === "deny" ? "declined" : "allowed", { now, choice });
    if (choice === "always") {
      const ruleId = nextId(doc, "r");
      doc.rules ||= {};
      doc.rules[ruleId] = { id: ruleId, tool: ask.tool, target: ask.ruleTarget, label: ask.ruleLabel, createdAt: ask.decidedAt };
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
