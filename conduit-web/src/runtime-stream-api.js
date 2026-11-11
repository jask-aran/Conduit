/*
 * The hub refuses to send a name not here and the client's handler takes only these, so an event one side sends and
 * the other never hears cannot drift in. Plain data, no imports: the client takes it too.
 */
export const RUNTIME_EVENTS = /** @type {const} */ ({
  ping: "the stream is alive (every 15 s); silence is how a client tells a dead one",
  runtime_global_snapshot: "where things stand: processes, devices, updates, a prepared restart, this connection's id",
  runtime_process: "a chat's process started or changed",
  runtime_process_removed: "a chat's process ended",
  devices_changed: "a paired environment came or went",
  terminal_changed: "a terminal was created, changed or exited",
  terminal_removed: "a terminal was removed",
  chat_changed: "a chat's summary changed",
  workspace_changed: "files changed in these projects",
  agent_changed: "jbot's work moved on: its view is read again",
  updates_offered: "the hub offers a new interface build or installer",
  keybindings_changed: "keybindings.json changed on the hub",
  browser_changed: "the hub's browser changed",
  ui_command: "an agent's command to one tab (sent to its connection alone)",
  pwa_restart_prepared: "a restart is coming: a browser installs the new build and says so",
});

/** @param {unknown} type */
export const isRuntimeEvent = (type) => Object.hasOwn(RUNTIME_EVENTS, String(type));
