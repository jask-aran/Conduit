import { normalizeHostUiRequest } from "./activity.js";

export const PI_CAPABILITIES = Object.freeze({
  steer: true, followUpQueue: true, cancel: true, compaction: true,
  thinkingLevels: true, modelSwitch: true, toolUse: true, permissions: true,
  usage: true, replay: true,
});

// Keep the complete Pi payload until the v0 client no longer needs it. No event
// is discarded to fit a thinner backend, including unknown extension events.
export function normalizePiBackendEvent(event) {
  const base = { generationId: event.generationId || null, pi: event };
  switch (event.type) {
    case "content_block_delta":
      return { ...base, type: "assistant_content", phase: "delta", sequence: event.seq,
        messageId: event.messageId, contentIndex: event.contentIndex,
        blockKind: event.blockType === "toolCall" ? "tool_call" : event.blockType, delta: event.delta };
    case "assistant_message_completed":
      return { ...base, type: "assistant_content", phase: "final", sequence: event.seq,
        messageId: event.messageId, stopReason: event.stopReason, errorMessage: event.errorMessage,
        blocks: event.blocks.map(({ type, ...block }) => type === "toolCall"
          ? { kind: "tool_call", contentIndex: block.contentIndex, toolCallId: block.toolCallId, name: block.name, input: block.arguments }
          : { kind: type, ...block }) };
    case "tool_execution_started":
    case "tool_execution_updated":
    case "tool_execution_completed":
      return { ...base, type: "tool_activity", sequence: event.seq,
        phase: { tool_execution_started: "start", tool_execution_updated: "update", tool_execution_completed: "end" }[event.type],
        toolCallId: event.toolCallId, name: event.name, input: event.arguments,
        output: event.type === "tool_execution_updated" ? event.partialResult : event.result, isError: event.isError };
    case "extension_ui_request": {
      const request = normalizeHostUiRequest(event);
      if (!request) return { ...base, type: "pi_event" };
      const { id, ...fields } = request;
      return { ...base, type: "permission_request", requestId: id, ...fields };
    }
    case "extension_ui_resolved":
      return { ...base, type: "permission_resolved", requestId: event.requestId };
    case "runtime_state": {
      const session = event.session;
      const activity = session.activity || "idle";
      const status = activity === "failed" ? "failed" : activity === "stopping" ? "stopping"
        : activity === "idle" ? "idle" : "working";
      return { ...base, type: "runtime_state", status, activity,
        lifecycle: session.status === "stopped" ? "closed" : session.status === "starting" ? "restoring" : status,
        capabilities: PI_CAPABILITIES };
    }
    case "generation_resume":
      return { ...base, type: "runtime_state", generationId: event.generationId,
        sequence: event.seq, generation: event.generation, capabilities: PI_CAPABILITIES };
    case "session_checkpoint":
      return { ...base, type: "session_checkpoint", sequence: event.generationSeq ?? null };
    case "context_usage":
      return { ...base, type: "usage", contextUsage: event.contextUsage,
        sessionStats: event.sessionStats, cacheStats: event.cacheStats };
    case "client_error":
    case "runtime_error":
    case "generation_failed": {
      const error = event.error || event;
      const codes = ["generation_limit", "live_process_limit", "rpc_timeout", "rate_limited", "auth_expired", "backend_unavailable"];
      return { ...base, type: "error", error: {
        code: codes.includes(error.code) ? error.code : "backend_unavailable",
        message: error.message,
        ...(error.code === "rate_limited" ? { retryAfterMs: error.retryAfterMs ?? 60_000 } : {}),
      } };
    }
    default:
      return { ...base, type: "pi_event" };
  }
}

// The single existing browser protocol is a lossless projection of Pi events.
export function serializePiV0(event) {
  return JSON.stringify(normalizePiBackendEvent(event).pi);
}

export class PiRpcAdapter {
  constructor(manager) { this.manager = manager; }
  create(options) { return this.manager.createWithCapacity({ ...options, sessionFile: null }); }
  restore(opaqueSession, options) { return this.manager.createWithCapacity({ ...options, sessionFile: opaqueSession }); }
  prompt(id, message, options) { return this.manager.promptAccepted(id, message, options); }
  cancel(id, generationId) { return this.manager.abortGeneration(id, generationId); }
  close(id) { return this.manager.stopAndWait(id); }
  respondHostUi(id, response) { return this.manager.respondHostUi(id, response); }
  replay(id) {
    const record = this.manager.get(id);
    return record ? this.manager.currentGenerationResume(record) : null;
  }
  getCapabilities() { return PI_CAPABILITIES; }
  listModels(id) { return this.manager.getAvailableModels(id); }
  getModelState(id) { return this.manager.getModelState(id); }
  waitForSession(id) { return this.manager.waitForSession(id); }
  attach(id, socket) { return this.manager.attach(id, socket); }
  queue(id, type, message) { return this.manager.queueAccepted(id, type, message); }
  fork(id, entryId) { return this.manager.fork(id, entryId); }
  setModel(id, model) { return this.manager.setModel(id, model); }
  setThinkingLevel(id, level) { return this.manager.setThinkingLevel(id, level); }
  refreshContext(id) { return this.manager.refreshContextUsage(id); }
  sendPi(id, command) { return this.manager.send(id, command); }
  view(record) {
    const { sessionFile, sessionId, runtime, template, ...session } = this.manager.view(record);
    return { ...session, capabilities: PI_CAPABILITIES,
      pi: { runtime, template } };
  }
}

export class ChatBackendRegistry {
  constructor(manager) {
    const pi = new PiRpcAdapter(manager);
    this.adapters = new Map([["conduit_pi", pi], ["native_pi", pi]]);
  }
  forImplementation(implementation) {
    const adapter = this.adapters.get(implementation);
    if (!adapter) throw Object.assign(new Error("Chat backend is unavailable"), { code: "backend_unavailable", status: 409 });
    return adapter;
  }
  forChat(chat) {
    const implementation = chat?.backend?.implementation
      || (chat?.runtime?.kind === "native_pi" ? "native_pi" : "conduit_pi");
    const adapter = this.adapters.get(implementation);
    if (!adapter || (chat?.backend && chat.backend.protocol !== "pi_rpc")) {
      throw Object.assign(new Error("Chat backend is unavailable"), { code: "backend_unavailable", status: 409 });
    }
    return adapter;
  }
}
