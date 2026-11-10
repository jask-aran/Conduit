/*
 * The commands a client sends over a live session's stream (WS /v0/live-sessions/:id/stream), declared once. The hub
 * (server/live-session-stream.js) and the client (client/state/agent-session.ts) both read this list, so which
 * commands carry the sending client, which a read-only child accepts and which run at once cannot drift.
 *
 *   origin  carries `client`, the tab it was sent from: the chat's origin, where the agent shows things (ui-control.js)
 *   child   a read-only record (a subagent's chat) accepts it: it changes nothing
 *   urgent  runs at once, outside the chain and the chat's lifecycle, to interrupt what an earlier command started
 *
 * Plain data, no imports: the client takes it too.
 */
export const LIVE_COMMANDS = /** @type {const} */ ({
  prompt: { origin: true },
  follow_up: { origin: true },
  steer: { origin: true },
  fork_and_prompt: { origin: true },
  interrupt_and_send: {},
  regenerate: {},
  clear_queue: {},
  stop_generation: { urgent: true },
  extension_ui_response: {},
  compact: {},
  refresh_context: { child: true },
  frame_interval: { child: true },
  resume_log: { child: true },
});

/** @param {unknown} type @param {"origin" | "child" | "urgent"} trait */
export const liveCommandIs = (type, trait) => Boolean(Object.hasOwn(LIVE_COMMANDS, String(type)) && LIVE_COMMANDS[String(type)][trait]);
