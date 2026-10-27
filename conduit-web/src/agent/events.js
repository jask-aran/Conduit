/**
 * Conduit events and webhooks that wake the agent (plan decision 6). Codex job C fills this in; see the brief.
 *
 * `EventTools(runtime) → { tools: [watch] }`; `startEvents(agent, sources) → stop`; `webhook(agent, token, body)`.
 */
export function EventTools(runtime) { return { tools: [] }; }
export function startEvents(agent, sources) { return () => {}; }
export async function webhook(agent, token, body) { return null; }
export async function listWatches(agent) { return []; }
