import { wasAborted } from "./abort-signature.js";
import { normalizeHostUiRequest } from "./activity.js";
import { parseAttachmentEnvelope } from "./attachment-envelope.js";
import { detect } from "./harnesses/probe.js";

export const PI_CAPABILITIES = Object.freeze({
  steer: true, followUpQueue: true, cancel: true, compaction: true,
  thinkingLevels: true, modelSwitch: true, toolUse: true, permissions: true,
  usage: true, replay: true,
});

// Keep the complete Pi payload until the v0 client no longer needs it. No event
// is discarded to fit a thinner backend, including unknown extension events.
const queueText = (items) => (Array.isArray(items) ? items : [])
  .map((item) => parseAttachmentEnvelope(typeof item === "string" ? item : item?.message || "").message);

export function normalizePiBackendEvent(event) {
  const base = { generationId: event.generationId || null, pi: event };
  switch (event.type) {
    case "content_block_delta":
      return { ...base, type: "assistant_content", phase: "delta", sequence: event.seq,
        messageId: event.messageId, contentIndex: event.contentIndex,
        blockKind: event.blockType === "toolCall" ? "tool_call" : event.blockType, delta: event.delta };
    case "assistant_message_started":
      return { ...base, type: "assistant_content", phase: "start", sequence: event.seq, messageId: event.messageId };
    case "assistant_message_completed": {
      // An abort is not a failure. Normalising here keeps the streaming view
      // and the reloaded transcript telling the same story.
      const aborted = wasAborted(event);
      return { ...base, type: "assistant_content", phase: "final", sequence: event.seq,
        messageId: event.messageId,
        stopReason: aborted ? "aborted" : event.stopReason,
        errorMessage: aborted ? null : event.errorMessage,
        blocks: event.blocks.map(({ type, ...block }) => type === "toolCall"
          ? { kind: "tool_call", contentIndex: block.contentIndex, toolCallId: block.toolCallId, name: block.name, input: block.arguments }
          : { kind: type, ...block }) };
    }
    case "generation_started":
    case "generation_running":
      return { ...base, type: "status", sequence: event.seq, status: "working", activity: "working", detail: event.type };
    case "generation_stopping":
      return { ...base, type: "status", sequence: event.seq, status: "stopping", activity: "stopping", detail: event.type };
    case "generation_stopped":
      return { ...base, type: "status", sequence: event.seq, status: "idle", activity: "idle", detail: "stopped", processTerminated: event.processTerminated };
    case "generation_settled":
      return { ...base, type: "status", sequence: event.seq, status: "idle", activity: "idle", detail: "settled" };
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
      return { ...base, type: "generation_replay", generationId: event.generationId,
        sequence: event.seq, generation: event.generation };
    case "session_checkpoint":
      return { ...base, type: "session_checkpoint", sequence: event.generationSeq ?? null,
        chatId: event.chat?.id || event.chatId || "", title: event.chat?.title || event.title || null };
    case "queue_update":
      // Pi reports its queue as top-level arrays, not a nested object, so the
      // browser has always been told the queue was empty. activity.js reads the
      // arrays correctly, which is why the server record was right and only the
      // neutral event was wrong.
      // Pi holds the message as Conduit sent it, wrapped in the attachment
      // envelope. The browser wants what the user typed.
      return { ...base, type: "queue_state", queue: event.queue
        || { steering: queueText(event.steering), followUp: queueText(event.followUp) } };
    case "compaction_start":
    case "compaction_end":
      return { ...base, type: "compaction", active: event.type === "compaction_start" };
    case "auto_retry_start":
    case "generation_retry_started":
      return { ...base, type: "retry", active: true, retry: event.retry || event };
    case "auto_retry_end":
    case "generation_retry_ended":
      return { ...base, type: "retry", active: false };
    case "message_end": {
      const message = event.message;
      return { ...base, type: "transcript_message", message: wasAborted(message)
        ? { ...message, stopReason: "aborted", errorMessage: null }
        : message };
    }
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
  const { pi: _pi, ...neutral } = normalizePiBackendEvent(event);
  return JSON.stringify(neutral);
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
  toClientEvent(event) { const { pi: _pi, ...neutral } = normalizePiBackendEvent(event); return neutral; }
  listModels(id) { return this.manager.getAvailableModels(id); }
  getModelState(id) { return this.manager.getModelState(id); }
  waitForSession(id) { return this.manager.waitForSession(id); }
  attach(id, socket) {
    const replay = this.manager.attach(id, socket);
    return replay ? normalizePiBackendEvent(replay) : null;
  }
  queue(id, type, message) { return this.manager.queueAccepted(id, type, message); }
  clearQueue(id) { return this.manager.clearQueue(id); }
  readTranscript(id, options) { return this.manager.readTranscript(id, options); }
  fork(id, entryId) { return this.manager.fork(id, entryId); }
  setModel(id, model) { return this.manager.setModel(id, model); }
  setThinkingLevel(id, level) { return this.manager.setThinkingLevel(id, level); }
  refreshContext(id) { return this.manager.refreshContextUsage(id); }
  sendNative(id, command) { return this.manager.send(id, command); }
  publish(record, event) { return this.manager.publish(record, event); }
  view(record) {
    return { ...this.manager.view(record), capabilities: PI_CAPABILITIES };
  }
}

export class ChatBackendRegistry {
  // Backends used to be named positionally here. They are now built from the
  // harness manifests via `fromManifests`; the bare `manager` form remains for
  // the Pi-only callers that never had a second backend.
  constructor(manager = null, adapters = null) {
    this.adapters = new Map();
    this.manifests = new Map();
    this.detection = new Map();
    if (adapters) {
      for (const [implementation, adapter] of adapters) this.adapters.set(implementation, adapter);
      return;
    }
    if (manager) {
      const pi = new PiRpcAdapter(manager);
      this.adapters.set("conduit_pi", pi);
      this.adapters.set("native_pi", pi);
    }
  }

  /**
   * Register every harness its probe found. Built-in backends ship with
   * Conduit and register regardless; the rest must be installed and usable.
   */
  static fromManifests(manifests, detection, config) {
    const registry = new ChatBackendRegistry();
    registry.detection = detection;
    registry.manifestList = manifests;
    registry.config = config;
    registry.register(manifests, detection, config);
    return registry;
  }

  register(manifests, detection, config) {
    for (const manifest of manifests) {
      const implementations = manifest.implementations || [manifest.id];
      if (implementations.some((implementation) => this.adapters.has(implementation))) continue;
      if (!manifest.builtIn && !detection.get(manifest.id)?.available) continue;
      const adapter = manifest.build(config);
      for (const implementation of implementations) {
        this.adapters.set(implementation, adapter);
        this.manifests.set(implementation, manifest);
      }
    }
  }

  /**
   * Re-probe without a restart, so installing a harness makes it visible.
   * A backend that has become available is registered; one that has gone away
   * keeps its adapter, because live records may still be attached to it.
   */
  async refreshDetection(manifests = this.manifestList, config = this.config) {
    if (!manifests) return this.detection;
    this.detection = await detect(manifests, config);
    this.register(manifests, this.detection, config);
    return this.detection;
  }

  /** The manifest behind an implementation key, when it registered. */
  manifestFor(implementation) { return this.manifests.get(implementation) || null; }

  /** Implementations whose manifest satisfies a predicate, e.g. machine discovery. */
  where(predicate) {
    return [...this.manifests].filter(([, manifest]) => predicate(manifest)).map(([implementation]) => implementation);
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
    if (!adapter) {
      throw Object.assign(new Error("Chat backend is unavailable"), { code: "backend_unavailable", status: 409 });
    }
    return adapter;
  }
  adapterForRecord(record) { return this.adapters.get(record?.adapterImplementation || "conduit_pi"); }
  get(id) {
    for (const adapter of new Set(this.adapters.values())) {
      const record = adapter.get ? adapter.get(id) : adapter.manager.get(id);
      if (record) return record;
    }
    return null;
  }
  getByChatId(chatId) {
    for (const adapter of new Set(this.adapters.values())) {
      const record = adapter.getByChatId ? adapter.getByChatId(chatId) : adapter.manager.getByChatId(chatId);
      if (record) return record;
    }
    return null;
  }
  list() {
    return [...new Set(this.adapters.values())].flatMap((adapter) => adapter.list ? adapter.list() : adapter.manager.list());
  }
  view(record) { return this.adapterForRecord(record).view(record); }
  stop(id) {
    const record = this.get(id);
    if (!record) return false;
    void this.adapterForRecord(record).close(id);
    return true;
  }
}
