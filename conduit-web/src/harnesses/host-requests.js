/**
 * A request is taken exactly once: answered, withdrawn, or cancelled with its turn; a second take changes nothing. It
 * returns events and the adapter publishes them, since every adapter publishes its own way.
 */

const store = (record) => (record.hostRequests ||= new Map());

/**
 * A request with no `host` is held but never shown. Asking again under an id that is open replaces it.
 *
 * @returns {object | null}
 */
export function ask(record, id, host, held = {}) {
  const open = store(record);
  open.delete(id);
  open.set(id, { ...held, id, host });
  if (!host) return null;
  return { type: "permission_request", generationId: held.generationId ?? record.generation?.id ?? null, requestId: id, ...host };
}

/**
 * Null when it was not open, so whatever the caller would have done with it is not done twice.
 *
 * @returns {{ id: string, host: object | null, event: object | null } & Record<string, any> | null}
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

/** A copy, so taking while iterating is safe. */
export const asked = (record) => [...(record?.hostRequests?.values() || [])];

export const takeAll = (record) => asked(record).map((held) => take(record, held.id));

export function shownCount(record) {
  let count = 0;
  for (const held of record?.hostRequests?.values() || []) if (held.host) count++;
  return count;
}

export const hostsOf = (record) => asked(record).flatMap((held) => held.host ? [held.host] : []);
