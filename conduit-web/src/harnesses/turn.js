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
  || (record.generation && !record.generation.closed && !record.generation.settled)));
