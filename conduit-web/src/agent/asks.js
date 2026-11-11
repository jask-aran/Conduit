import { notice } from "../context/notices.js";
import { nextId } from "./agent-doc.js";
import { permissionChoices } from "../approval-api.js";

const HOUR24 = 86400_000;
const WEEK = 7 * HOUR24;

/*
 * The one place that reads or moves an ask's status. Expiry is worked out when read, not swept, so nothing has to
 * write it. A yes lapses because it is to what was asked then, not to the same call weeks on.
 */
const MOVES = { pending: ["allowed", "declined", "expired"], allowed: ["used"] };
const ms = (now) => (typeof now === "number" ? now : now instanceof Date ? now.getTime() : Date.parse(now));
export const statusAt = (ask, now = Date.now()) => (ask.status === "pending" && Date.parse(ask.expiresAt) <= ms(now))
  || (ask.status === "allowed" && ask.lapsesAt && Date.parse(ask.lapsesAt) <= ms(now)) ? "expired" : ask.status;
export const opened = (now = new Date()) => ({ createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + HOUR24).toISOString(), status: "pending" });
/** A use records the call that used it, so a replay of that call is known for what it is. */
export function transition(ask, to, { now = new Date(), choice, callId, lapseMs = 0 } = {}) {
  if (!MOVES[statusAt(ask, now)]?.includes(to)) return false;
  ask.status = to;
  if (to === "allowed" || to === "declined") { ask.decidedAt = new Date(ms(now)).toISOString(); ask.choice = choice; }
  if (to === "allowed" && lapseMs > 0) ask.lapsesAt = new Date(ms(now) + lapseMs).toISOString();
  if (to === "used") ask.usedCallId = callId;
  return true;
}
export const prunable = (ask, now = Date.now()) => ["declined", "expired", "used"].includes(statusAt(ask, now)) && Date.parse(ask.decidedAt || ask.createdAt) < ms(now) - WEEK;
/* The reminder is kept on the ask, so it outlives the hub restarting: armReminders takes up every one still owed. */
const reminders = new WeakMap();
export function armReminder(agent, ask) {
  const timers = reminders.get(agent) || reminders.set(agent, new Map()).get(agent);
  if (!ask.remind || ask.reminded || timers.has(ask.id)) return;
  const timer = setTimeout(async () => {
    timers.delete(ask.id);
    try {
      const held = (await agent.state()).asks?.[ask.id];
      if (!held || held.reminded || statusAt(held) !== "pending") return;
      const pushed = await agent.runtime?.agentNotify?.(held.remind?.push || ask.remind.push);
      // Marked whether or not a device took it: it is one reminder, not one a restart.
      await agent.update((doc) => { const now = doc.asks?.[ask.id]; if (now) now.reminded = pushed || true; });
    } catch {}
  }, Math.max(0, Date.parse(ask.remind.at) - Date.now()));
  timer.unref?.();
  timers.set(ask.id, timer);
}
export async function armReminders(agent) {
  if (!agent?.enabled?.()) return;
  for (const ask of Object.values((await agent.state()).asks || {})) if (statusAt(ask) === "pending") armReminder(agent, ask);
}
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
    transition(ask, choice === "deny" ? "declined" : "allowed", { now, choice, lapseMs: Number(agent.settings().grantHours ?? 24) * 3600_000 });
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
