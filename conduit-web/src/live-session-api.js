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

/*
 * The events the hub sends a client over that stream, declared once. The hub (harnesses/session-records.js publish,
 * which refuses a name not here) and the client (client/api/live-events.ts, whose normalizer has a case for each
 * and whose LiveEvent may name no other) both read this list. Their shapes on the wire are ChatBackendEvent
 * (chat-backend-contract.d.ts); the client's LiveEvent is the shape after normalizeLiveEvent.
 *
 * Each name is mapped to what it tells.
 */
export const LIVE_EVENTS = /** @type {const} */ ({
  assistant_content: "paint: an assistant message arriving",
  tool_activity: "paint: a tool running, and its output as it arrives",
  generation_replay: "the running turn restated, for a client that arrives or returns during it",
  status: "a turn's transition (phase), or what the session is busy with",
  error: "a runtime failure (the turn is lost) or a refused command (the turn is untouched)",
  retry: "the harness is retrying the request, or has stopped retrying",
  permission_request: "the harness is waiting on an answer from the user",
  permission_resolved: "that answer was given",
  usage: "what the session has spent",
  queue_state: "what is queued behind the current turn",
  compaction: "the context is being compacted, or has finished",
  runtime_state: "where the session stands, and what a client arriving late has missed",
  session_checkpoint: "the turn's record is settled: the chat row, its title, its artifacts",
  transcript_op: "the record: what the transcript holds",
  transcript_sync: "the backend's own record of recent turns, to repair drift",
  history_truncated: "where the history now ends",
  log_state: "where the chat's order stands",
  log_reset: "the order a client held no longer exists: take the transcript again",
  agents_changed: "the chat's subagents changed: read them again",
  extension_notice: "a notice said once, as a toast, never kept in the transcript",
});

/** @param {unknown} type */
export const isLiveEvent = (type) => Object.hasOwn(LIVE_EVENTS, String(type));

/** @param {unknown} type @param {"origin" | "child" | "urgent"} trait */
export const liveCommandIs = (type, trait) => Boolean(Object.hasOwn(LIVE_COMMANDS, String(type)) && LIVE_COMMANDS[String(type)][trait]);
