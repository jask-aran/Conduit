import { shownCount } from "./host-requests.js";

/** A record's `activity` is this, so nothing can write it beside the facts it summarises. */
export const openRequests = shownCount;

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
 * Codex waits for the app-server's turn/started, so between sending turn/start and hearing it the turn is
 * `turnStarting`. (Not `answering`: several adapters keep the prompt they last answered there.)
 */
export const turnInFlight = (record) => Boolean(record && (record.active || record.turnStarting || record.stopping
  || record.compacting || openRequests(record)
  || (record.generation && !record.generation.settled)));

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

/** If the ask never reached the harness the turn is still running, so the flag is taken back. */
export async function stopTurn(record, send) {
  const generation = record.generation;
  record.stopping = true;
  try { return await send(); }
  catch (cause) {
    if (record.generation === generation && record.active) record.stopping = false;
    throw cause;
  }
}

/**
 * The harness's word stands: a turn it says completed did, even if the stop was already on its way. The stop decides
 * only where the harness says the turn failed or says nothing: a turn that errors as it is stopped was stopped.
 *
 * @param {"complete" | "interrupted" | "failed" | null | undefined} reported
 * @returns {"complete" | "interrupted" | "failed" | null}
 */
export const outcomeOf = (reported, stopping) => reported === "complete" || reported === "interrupted" ? reported
  : stopping ? "interrupted" : reported || null;

/**
 * `turnEnded` is numbered when it is made, so an adapter may publish what the turn left open in between.
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
