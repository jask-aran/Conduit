/**
 * What a session is doing, read from the facts its adapter keeps.
 *
 * Every adapter used to write `record.activity` by hand beside the flags it
 * was a summary of, and the two drifted: a stop with an approval open read
 * "working", answering one of two approvals read "working" with the other
 * still up. It is stated once here, and a record's `activity` is this
 * (SessionRecords.add), so nothing can write it.
 *
 * The facts, each owned by the adapter:
 *   status         "starting" until the harness can answer
 *   failed         the last turn ended in an error; cleared when the next begins
 *   stopping       a stop was asked for and the turn has not ended yet
 *   approvals / hostUiRequests   what the person has been asked and not answered
 *   compacting     the harness is compacting its context
 *   active         a turn is running
 *   turnStarting   a turn was sent and the harness has not said it began
 */
export const openRequests = (record) => record?.approvals?.size ?? record?.hostUiRequests?.length ?? 0;

/** @returns {import("../chat-backend-contract.js").ChatActivity} */
export function activityOf(record) {
  if (!record) return "idle";
  if (record.status === "starting") return "starting";
  if (record.failed) return "failed";
  if (record.stopping) return "stopping";
  if (openRequests(record)) return "waiting_for_user";
  if (record.compacting) return "compacting";
  return record.active || record.turnStarting ? "working" : "idle";
}

/**
 * A turn is under way, by any of the ways an adapter says so. Most claim a turn
 * by setting `active`; Codex waits for the app-server's turn/started, so between
 * sending turn/start and hearing it the turn is `turnStarting`. (Not
 * `answering`: several adapters keep the prompt they last answered there.)
 */
export const turnInFlight = (record) => Boolean(record && (record.active || record.turnStarting || record.stopping
  || record.compacting || openRequests(record)
  || (record.generation && !record.generation.settled)));

/**
 * A turn begins: the record's side of it, and the statement. Each adapter says when (Codex on turn/started, durable
 * once for a turn begun before its run), and may carry a stop asked for while the turn was still on its way.
 */
export function beginTurn(record, generationId, { stopping = false } = {}) {
  record.active = true;
  record.turnStarting = false;
  record.failed = false;
  record.stopping = stopping;
  record.generation = { id: generationId, settled: false };
}

export const turnStarted = (record, generationId = record.generation.id) => ({
  type: "status", generationId, phase: "started", seq: ++record.generationSeq, status: "working", activity: "working", detail: null,
});

/**
 * How a turn ended, when the person asked it to stop: the harness's word stands. A turn it says completed did, even
 * if the stop was already on its way, and one it says was interrupted was. The stop decides only where the harness
 * says the turn failed or says nothing (a timer gave up on it, the request was aborted): a turn that errors as it
 * is stopped was stopped. Adapters each ruled on this themselves and three ways.
 *
 * @param {"complete" | "interrupted" | "failed" | null | undefined} reported what the harness said
 * @returns {"complete" | "interrupted" | "failed" | null} null when nobody said and nobody stopped it
 */
export const outcomeOf = (reported, stopping) => reported === "complete" || reported === "interrupted" ? reported
  : stopping ? "interrupted" : reported || null;

/**
 * A turn ends, the same way on every harness.
 *
 * Each adapter used to clear these by hand and word the last status itself,
 * and they disagreed: a stopped turn ended "settled" on four of them and
 * "stopped" on three, a failed one read "failed" on some and "idle" on others,
 * and Codex and ChatGPT Web ended a failed turn with an error and no status at
 * all -- so no other page was told it had ended and its timing was never kept.
 *
 * `endTurn` is the record's side of it; `turnEnded` is the statement, numbered
 * when it is made so an adapter may publish what the turn left open in between.
 *
 * @param {"complete" | "interrupted" | "failed"} outcome
 */
export function endTurn(record, outcome) {
  record.active = false;
  record.turnStarting = false;
  record.stopping = false;
  record.failed = outcome === "failed";
  if (record.generation) record.generation.settled = true;
}

/** @param {"complete" | "interrupted" | "failed"} outcome */
export const turnEnded = (record, outcome, generationId = record.generation?.id || null) => ({
  type: "status", generationId, phase: outcome === "interrupted" ? "stopped" : "settled", seq: ++record.generationSeq,
  status: outcome === "failed" ? "failed" : "idle", activity: activityOf(record), detail: null,
});
