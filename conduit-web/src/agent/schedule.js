/**
 * The agent's clocks (plan decision 6, schedule and heartbeat). Codex job D fills this in; see the brief.
 *
 * `ScheduleTools(runtime) → { tools: [schedule], tasks: [clock] }`; `seedSchedules(agent)` keeps the brief and
 * heartbeat schedules matching settings; `listSchedules(agent)` for the attention list.
 */
export function ScheduleTools(runtime) { return { tools: [], tasks: [] }; }
export async function seedSchedules(agent) {}
export async function listSchedules(agent) { return []; }
