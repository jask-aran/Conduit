/**
 * What a session has asked the person and not yet heard back: its host-UI requests.
 *
 * Each adapter used to keep a map of what it had asked, to answer the harness with, beside an array of the cards
 * views read, and publish both ends by hand; the two drifted. OpenCode said "resolved" for permissions it had
 * answered itself and never shown, and the test stream ended a turn with its card gone and nothing said. It is
 * kept once here, in `record.hostRequests`, and views and `openRequests` read it.
 *
 * A request is asked, and then taken exactly once: answered, withdrawn (answered elsewhere, or gone from the
 * harness's own list), or cancelled with its turn. Which of those, and when a turn's are cancelled, stays each
 * adapter's; the store only makes a second take of the same request change nothing.
 *
 * Like `turnStarted`, it returns events and the adapter publishes them, since every adapter publishes its own way.
 */

const store = (record) => (record.hostRequests ||= new Map());

/**
 * Hold a request until it is taken. `held` is whatever answering the harness needs later (a resolver, an rpc id,
 * the decisions each option means), and may carry the `generationId` it belongs to where that is not the turn's.
 * A request with no `host` is held but never shown, so there is nothing to publish (OpenCode's auto accept).
 * Asking again under an id that is open replaces it.
 *
 * @returns {object | null} the `permission_request` to publish
 */
export function ask(record, id, host, held = {}) {
  const open = store(record);
  open.delete(id);
  open.set(id, { ...held, id, host });
  if (!host) return null;
  return { type: "permission_request", generationId: held.generationId ?? record.generation?.id ?? null, requestId: id, ...host };
}

/**
 * The request is no longer open. Null when it was not (already answered, a duplicate click, a stale card), so
 * whatever the caller would have done with it is not done twice.
 *
 * @returns {{ id: string, host: object | null, event: object | null } & Record<string, any> | null} what was held,
 *   with the `permission_resolved` to publish (null for one never shown)
 */
export function take(record, id) {
  const held = record.hostRequests?.get(id);
  if (!held) return null;
  record.hostRequests.delete(id);
  const event = held.host
    ? { type: "permission_resolved", generationId: held.generationId ?? record.generation?.id ?? null, requestId: id }
    : null;
  return { ...held, event };
}

/** An open request, left open: for an answer that has to reach the harness before the card can go. */
export const heldOf = (record, id) => record?.hostRequests?.get(id) || null;

/** Everything open, shown or not, to answer or cancel. A copy, so taking while iterating is safe. */
export const asked = (record) => [...(record?.hostRequests?.values() || [])];

/** Take every open request: the turn they belonged to is over. */
export const takeAll = (record) => asked(record).map((held) => take(record, held.id));

/** How many cards are up: what a session waits on the person for (turn.js `openRequests`). */
export function shownCount(record) {
  let count = 0;
  for (const held of record?.hostRequests?.values() || []) if (held.host) count++;
  return count;
}

/** The cards a view shows as `hostUiRequests`, in the order they were asked. */
export const hostsOf = (record) => asked(record).flatMap((held) => held.host ? [held.host] : []);
