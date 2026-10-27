/**
 * The agent's memory (plan decision 8). Codex job A fills this in; see the brief.
 *
 * `MemoryTools(runtime) → { tools: [memory], sections: [memory snapshot] }`.
 * Proposal helpers are called by the HTTP routes (server/routes/agent.js).
 */
export function MemoryTools(runtime) { return { tools: [], sections: [] }; }
export async function listProposals(agent) { return []; }
export async function acceptProposal(agent, id) { return null; }
export async function rejectProposal(agent, id) { return null; }
