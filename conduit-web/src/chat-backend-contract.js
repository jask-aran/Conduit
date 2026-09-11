export const CHAT_CAPABILITY_KEYS = Object.freeze([
  "steer", "followUpQueue", "cancel", "compaction", "thinkingLevels",
  "modelSwitch", "toolUse", "permissions", "usage", "replay",
]);

export const REQUIRED_CHAT_BACKEND_METHODS = Object.freeze([
  "create", "restore", "prompt", "cancel", "close", "respondHostUi", "replay",
  "waitForSession", "attach", "view", "toClientEvent", "publish", "queue",
  "clearQueue", "fork", "setModel", "setThinkingLevel", "refreshContext",
  "readTranscript", "getCapabilities", "listModels", "getModelState", "get",
  "getByChatId", "list",
]);

export function assertChatBackendAdapter(adapter, label = "unknown", expectedCapabilities = null) {
  if (!adapter || typeof adapter !== "object") {
    throw new TypeError(`Chat backend ${label} did not build an adapter`);
  }
  const missing = REQUIRED_CHAT_BACKEND_METHODS.filter((method) => typeof adapter[method] !== "function");
  if (missing.length) {
    throw new TypeError(`Chat backend ${label} is missing adapter methods: ${missing.join(", ")}`);
  }
  const capabilities = adapter.getCapabilities();
  const invalid = CHAT_CAPABILITY_KEYS.filter((key) => typeof capabilities?.[key] !== "boolean");
  if (invalid.length) {
    throw new TypeError(`Chat backend ${label} has invalid capabilities: ${invalid.join(", ")}`);
  }
  const mismatched = expectedCapabilities
    ? CHAT_CAPABILITY_KEYS.filter((key) => capabilities[key] !== expectedCapabilities[key])
    : [];
  if (mismatched.length) {
    throw new TypeError(`Chat backend ${label} capabilities disagree with its manifest: ${mismatched.join(", ")}`);
  }
  return adapter;
}
