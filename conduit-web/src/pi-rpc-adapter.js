import { wasAborted, wasDiscarded } from "./abort-signature.js";
import { normalizeHostUiRequest } from "./pi-activity.js";
import { parseAttachmentEnvelope } from "./attachment-envelope.js";
import { assertChatBackendAdapter } from "./chat-backend-contract.js";
import { formatHistoryTool } from "./harnesses/history-tool.js";
import { detect } from "./harnesses/probe.js";
import { PI_CAPABILITIES, PI_TOOL_KINDS, piToolSubject } from "./pi-capabilities.js";
import { toolKind } from "./harnesses/transcript-ops.js";
import { launchConduitPi } from "./pi-launch.js";

export { PI_CAPABILITIES };


// Keep the complete Pi payload until the v0 client no longer needs it. No event
// is discarded to fit a thinner backend, including unknown extension events.
const queueText = (items) => (Array.isArray(items) ? items : [])
  .map((item) => parseAttachmentEnvelope(typeof item === "string" ? item : item?.message || "").message);

const historyText = (content) => {
  const text = typeof content === "string" ? content : Array.isArray(content)
    ? content.map((part) => typeof part?.text === "string" ? part.text : "").join(" ") : "";
  return parseAttachmentEnvelope(text).message.replace(/\s+/g, " ").trim().slice(0, 240);
};


const historyTreeView = (tree) => {
  const tools = new Map();
  const pending = [...tree];
  while (pending.length) {
    const node = pending.pop();
    pending.push(...(node.children || []));
    if (node.entry?.type !== "message" || node.entry.message?.role !== "assistant") continue;
    for (const part of Array.isArray(node.entry.message.content) ? node.entry.message.content : []) {
      if (part?.type === "toolCall" && part.id) tools.set(part.id, { name: part.name, arguments: part.arguments });
    }
  }
  const project = (node) => {
    const message = node.entry.message;
    const text = historyText(message?.content ?? node.entry.content ?? node.entry.summary);
    const tool = message?.toolCallId ? tools.get(message.toolCallId) : null;
    const display = message?.role === "user" ? `user: ${text}`
      : message?.role === "assistant" ? `assistant: ${text || message.errorMessage || "(no content)"}`
      : message?.role === "toolResult" ? formatHistoryTool(tool?.name || message.toolName || "tool", tool?.arguments)
      : message?.role === "bashExecution" ? `[bash: ${String(message.command || "").replace(/\s+/g, " ").trim()}]`
      : node.entry.type === "compaction" ? "[compaction]"
      : node.entry.type === "branch_summary" ? `[branch summary]: ${text}` : text;
    const settings = ["label", "custom", "model_change", "thinking_level_change", "session_info"].includes(node.entry.type);
    // Pi keeps an interrupted message in its session tree and then builds every
    // later request without it, so the node is real but the conversation does
    // not contain it. The pane is told, rather than showing it as an ordinary
    // step somebody could reason about or navigate to.
    // The same question the transcript asks, asked the same way. This used to
    // read `stopReason === "aborted"` on its own, which misses the form a stop
    // actually takes on the wire -- a provider error saying the operation was
    // aborted -- so the pane and the transcript could disagree about one
    // message.
    const discarded = wasDiscarded({ ...message, content: text },
      { keepsPartial: PI_CAPABILITIES.interruptKeepsPartial });
    const toolOnlyAssistant = message?.role === "assistant" && !text && !message.errorMessage;
    const kind = message?.role === "user" ? "user"
      : message?.role === "assistant" ? "assistant"
      : ["toolResult", "bashExecution"].includes(message?.role) ? "tool"
      : node.entry.type === "branch_summary" ? "summary" : "system";
    return { entry: {
    id: node.entry.id,
    parentId: node.entry.parentId ?? null,
    timestamp: node.entry.timestamp,
    type: node.entry.type,
    display,
    kind,
    hidden: settings || toolOnlyAssistant,
    ...(discarded ? { discarded: true } : {}),
    forkable: kind === "user",
    regeneratable: kind === "user",
  },
  ...(node.label ? { label: node.label } : {}),
  children: (node.children || []).map(project),
    };
  };
  return tree.map(project);
};

export function normalizePiBackendEvent(event) {
  // The number the chat's log gave this event travels with it, whatever shape
  // the event takes on the way out. It is how the browser knows its copy of the
  // transcript is complete, and what it asks to be caught up from.
  const base = { generationId: event.generationId || null, pi: event,
    ...(event.log ? { log: event.log } : {}) };
  switch (event.type) {
    case "content_block_delta":
      return { ...base, type: "assistant_content", phase: "delta", seq: event.seq,
        messageId: event.messageId, contentIndex: event.contentIndex,
        blockKind: event.blockKind, delta: event.delta,
        ...(event.name ? { name: event.name, toolKind: event.toolKind } : {}),
        ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}) };
    case "assistant_message_started":
      return { ...base, type: "assistant_content", phase: "start", seq: event.seq, messageId: event.messageId };
    case "assistant_message_completed": {
      // An abort is not a failure. Normalising here keeps the streaming view
      // and the reloaded transcript telling the same story.
      const aborted = wasAborted(event);
      return { ...base, type: "assistant_content", phase: "final", seq: event.seq,
        messageId: event.messageId,
        stopReason: aborted ? "aborted" : event.stopReason,
        errorMessage: aborted ? null : event.errorMessage,
        // Already Conduit's blocks: the normalizer turns Pi's names into them
        // where it reads Pi's wire, which is the only place they belong.
        blocks: event.blocks,
        provider: event.provider ?? null,
        model: event.model ?? null,
        timestamp: event.timestamp ?? null };
    }
    // The transition is stated. `detail` used to carry Pi's own event name so
    // the browser could read it back out, which made a free-text field the
    // only record of which of these five had happened.
    // What the turn is continuing travels with the transition that opens it.
    // It used to be dropped here, so only the server held it -- and the browser
    // learned it from the replay a reconnect sends. A reader who stayed
    // connected watched a continued answer render as the fragment alone,
    // without the text it continues, until they reloaded.
    case "generation_started":
      return { ...base, type: "status", phase: "started", seq: event.seq, status: "working", activity: "working", detail: null,
        ...(event.continuation ? { continuation: true, continuationBase: String(event.continuationBase || "") } : {}) };
    case "generation_running":
      return { ...base, type: "status", phase: "running", seq: event.seq, status: "working", activity: "working", detail: null };
    case "generation_stopping":
      return { ...base, type: "status", phase: "stopping", seq: event.seq, status: "stopping", activity: "stopping", detail: null };
    case "generation_stopped":
      return { ...base, type: "status", phase: "stopped", seq: event.seq, status: "idle", activity: "idle", detail: null, processTerminated: event.processTerminated };
    case "generation_settled":
      return { ...base, type: "status", phase: "settled", seq: event.seq, status: "idle", activity: "idle", detail: null };
    case "tool_execution_started":
    case "tool_execution_updated":
    case "tool_execution_completed":
      return { ...base, type: "tool_activity", seq: event.seq,
        phase: { tool_execution_started: "start", tool_execution_updated: "update", tool_execution_completed: "end" }[event.type],
        toolCallId: event.toolCallId, name: event.name, input: event.input,
        ...(event.type === "tool_execution_started" ? { kind: toolKind(PI_TOOL_KINDS, event.name), subject: piToolSubject(event.name, event.input) ?? undefined } : {}),
        output: event.output, isError: event.isError };
    case "extension_ui_request": {
      const request = normalizeHostUiRequest(event);
      if (!request) return { ...base, type: "pi_event" };
      const { id, ...fields } = request;
      return { ...base, type: "permission_request", requestId: id, ...fields };
    }
    case "extension_ui_resolved":
      return { ...base, type: "permission_resolved", requestId: event.requestId };
    // Everything the frame was given, plus the three the contract derives.
    //
    // This returned the derived three and nothing else, which threw away what
    // the frame is for. The catch-up sent on attach is built from
    // `adapter.view(record)` and carries the pending approvals, the queue and
    // the usage counters; the three harnesses whose `toClientEvent` is identity
    // deliver all of it, and Pi's -- the only one that rewrites the event --
    // dropped every field but four. So reconnecting to a Pi chat lost the
    // context bar until the next turn, lost the queued messages, and left a
    // confirmation Pi was waiting on undrawn.
    case "runtime_state": {
      const { type: _type, pi: _raw, log: _log, generationId: _generation, ...state } = event;
      const activity = state.session?.activity || "idle";
      const status = activity === "failed" ? "failed" : activity === "stopping" ? "stopping"
        : activity === "idle" ? "idle" : "working";
      return { ...base, type: "runtime_state", ...state, status, activity,
        lifecycle: state.session?.status === "stopped" ? "closed"
          : state.session?.status === "starting" ? "restoring" : status,
        capabilities: PI_CAPABILITIES };
    }
    case "generation_resume":
      return { ...base, type: "generation_replay", generationId: event.generationId,
        seq: event.seq, generation: event.generation };
    // The process is gone, and whether that was asked for is the whole of what
    // the browser needs to know: a deliberate exit settles the session, a crash
    // reconnects. Without a case here it fell through to `pi_event`, taking
    // `deliberate` with it, so "Stop process" read as a dropped connection and
    // the reconnect timer started a replacement within the second. The client
    // has had the handler for this all along; nothing ever reached it.
    case "runtime_exit":
      return { ...base, type: "runtime_exit", deliberate: event.deliberate === true };
    // The server reads Pi's own session file after a turn and republishes it as
    // the authority on what was said. Without a case here it fell through to
    // the opaque `pi_event`, so the browser kept its optimistic message ids -
    // and anything keyed by a persisted id (turn artifacts, fork, regenerate)
    // only worked after a reload.
    // A fork states where the history now ends. The browser cuts to it rather
    // than working out which of its messages the fork abandoned.
    case "history_truncated":
      return { ...base, type: "history_truncated",
        beforeMessageId: event.beforeMessageId || null,
        afterMessageId: event.afterMessageId || null };
    case "transcript_sync":
      // `replace` marks the whole transcript, not a window of it: the client
      // takes it as the entire truth rather than folding it into what it holds.
      return { ...base, type: "transcript_sync", messages: event.messages || [], tools: event.tools || [],
        ...(event.replace ? { replace: true } : {}) };
    // What the server has decided about the transcript: a message exists, is
    // finished, or is gone, and where it sits. Passed through whole -- the op
    // is already the neutral statement, not a Pi shape needing translation.
    case "transcript_op":
      return { ...event, ...base };
    // Where the chat's order stands, and where a client has to give up its own
    // copy and take a fresh one.
    case "log_state":
      return { ...base, type: "log_state", log: event.log };
    case "log_reset":
      return { ...base, type: "log_reset", log: event.log };
    // A checkpoint says the turn's record on disk is settled, and carries the
    // chat row and the artifacts the turn wrote. It used to carry a number as
    // well, spelled `sequence` where the native adapters raised it,
    // `generationSeq` where Pi's did, and `seq` on the wire -- so it arrived
    // null for three of the four harnesses, and nothing in the browser read it.
    case "session_checkpoint":
      return { ...base, type: "session_checkpoint", artifacts: event.artifacts ?? null,
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
    // A retry is a step in the turn, so it keeps the turn-local position the
    // normalizer gave it. Dropping `seq` left the only two lifecycle events
    // with no place in the sequence they belong to, which a reducer reading
    // this stream has to reject.
    case "auto_retry_start":
    case "generation_retry_started":
      return { ...base, type: "retry", active: true, retry: event.retry || event,
        ...(event.seq === undefined ? {} : { seq: event.seq }) };
    case "auto_retry_end":
    case "generation_retry_ended":
      return { ...base, type: "retry", active: false,
        ...(event.seq === undefined ? {} : { seq: event.seq }) };
    // A user message Pi has committed was already stated as a `message.open`
    // -- by the prompt that sent it, or, for one off the queue or typed into a
    // driven thread's CLI, at the moment Pi first reported it. Announcing it a
    // second time under its own event type was the older way of saying the same
    // thing, and the two could disagree about where it went.
    case "message_end":
      return { ...base, type: "pi_event" };
    case "context_usage":
      return { ...base, type: "usage", contextUsage: event.contextUsage,
        sessionStats: event.sessionStats, cacheStats: event.cacheStats };
    case "runtime_error":
    case "generation_failed": {
      const error = event.error || event;
      const codes = ["generation_limit", "live_process_limit", "rpc_timeout", "rate_limited", "auth_expired", "backend_unavailable"];
      return { ...base, type: "error", scope: "runtime",
        ...(event.seq === undefined ? {} : { seq: event.seq }), error: {
        code: codes.includes(error.code) ? error.code : "backend_unavailable",
        message: error.message,
        ...(error.code === "rate_limited" ? { retryAfterMs: error.retryAfterMs ?? 60_000 } : {}),
      } };
    }
    default:
      return { ...base, type: "pi_event" };
  }
}

/**
 * The one translation out of Pi's words, or null when there is nothing to say.
 *
 * `serializePiV0` and `toClientEvent` each used to spell this out for
 * themselves, so Pi had two projections that happened to agree. Everything
 * leaving for a browser -- the publish path, the attach path, a log replay --
 * goes through this one.
 *
 * Null is the answer for an event Conduit has decided the browser does not
 * need. Those used to travel anyway, as a `pi_event` envelope with the native
 * payload stripped out of it: across the Pi fixtures, 46 of 125 events -- every
 * `content_block_started`, every `content_block_completed`, every
 * `generation_turn_ended` -- crossed the socket carrying a type and a
 * generation id and nothing else, for the browser to normalize to `unknown`
 * and drop. A third of the frames in a turn, each costing a send, a parse and
 * a pass through the client's reducer to reach a `break`.
 */
export function toNeutralPiEvent(event) {
  // A log replay is already on the far side of Pi's adapter. Its stamp proves
  // that it came from the neutral chat log rather than directly from Pi.
  if (event?.log && [
    "transcript_op", "transcript_sync", "session_checkpoint", "status", "error",
  ].includes(event.type)) return event;
  const { pi: _pi, ...neutral } = normalizePiBackendEvent(event);
  return neutral.type === "pi_event" ? null : neutral;
}

/** A frame for the browser, or null when there is nothing to send it. */
export const serializePiV0 = (event) => {
  const neutral = toNeutralPiEvent(event);
  return neutral === null ? null : JSON.stringify(neutral);
};

export class PiRpcAdapter {
  constructor(manager) { this.manager = manager; }
  launch(context, request, services) { return launchConduitPi(this, context, request, services); }
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
  toClientEvent(event) { return toNeutralPiEvent(event); }
  setFrameInterval(id, socket, ms) { return this.manager.setFrameInterval(id, socket, ms); }
  listModels(id) { return this.manager.getAvailableModels(id); }
  listCommands(id) { return this.manager.getCommands(id); }
  listAvailableCommands({ cwd, template }) { return this.manager.listAvailableCommands({ cwd, template }); }
  getModelState(id) { return this.manager.getModelState(id); }
  get(id) { return this.manager.get(id); }
  getByChatId(chatId) { return this.manager.getByChatId(chatId); }
  list() { return this.manager.list(); }
  rawRecords() { return this.manager.rawRecords(); }
  waitForSession(id) { return this.manager.waitForSession(id); }
  // What a reconnecting browser has to be told before anything live. It is
  // returned in Pi's words and translated where it is sent, like every other
  // event: translating it here instead made this the one path whose serializer
  // lived somewhere else, and before that it was the one path with no
  // serializer at all -- a reconnect put native Pi in front of the browser,
  // carrying a second copy of the whole generation snapshot with it.
  attach(id, socket) { return this.manager.attach(id, socket); }
  queue(id, type, message, options) { return this.manager.queueAccepted(id, type, message, options); }
  clearQueue(id) { return this.manager.clearQueue(id); }
  readTranscript({ liveSessionId, ...options }) { return this.manager.readTranscript(liveSessionId, options); }
  async fork(id, target) {
    const result = await this.manager.fork(id, target.nodeId);
    const record = this.manager.get(id);
    return {
      ...result,
      opaqueSession: record?.sessionFile || null,
      sourceMessage: result?.text ? { id: target.nodeId, text: result.text } : null,
    };
  }
  async readHistory({ liveSessionId, opaqueSession, project }) {
    const result = liveSessionId
      ? await this.manager.getHistoryTree(liveSessionId)
      : await this.manager.readHistoryTree(opaqueSession, project?.workingRoot);
    return { mode: "tree", leafId: result?.leafId || null, tree: historyTreeView(result?.tree || []) };
  }
  setModel(id, model) { return this.manager.setModel(id, model); }
  setThinkingLevel(id, level) { return this.manager.setThinkingLevel(id, level); }
  refreshContext(id) { return this.manager.refreshContextUsage(id); }
  compact(id) { return this.manager.compact(id); }
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
      for (const [implementation, adapter] of adapters) this.adapters.set(implementation, assertChatBackendAdapter(adapter, implementation));
      return;
    }
    if (manager) {
      const pi = assertChatBackendAdapter(new PiRpcAdapter(manager), "conduit-pi");
      this.adapters.set("conduit_pi", pi);
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
      const adapter = assertChatBackendAdapter(manifest.build(config), manifest.id, manifest.capabilities);
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
      || "conduit_pi";
    const adapter = this.adapters.get(implementation);
    if (!adapter) {
      throw Object.assign(new Error("Chat backend is unavailable"), { code: "backend_unavailable", status: 409 });
    }
    return adapter;
  }
  adapterForRecord(record) {
    const implementation = record?.adapterImplementation;
    if (!implementation) throw Object.assign(new Error("Live session has no backend identity"), { code: "backend_identity_missing" });
    const adapter = this.adapters.get(implementation);
    if (!adapter) throw Object.assign(new Error(`Chat backend is unavailable: ${implementation}`), { code: "backend_unavailable" });
    return adapter;
  }
  get(id) {
    for (const adapter of new Set(this.adapters.values())) {
      const record = adapter.get(id);
      if (record) return record;
    }
    return null;
  }
  getByChatId(chatId) {
    for (const adapter of new Set(this.adapters.values())) {
      const record = adapter.getByChatId(chatId);
      if (record) return record;
    }
    return null;
  }
  list() {
    return [...new Set(this.adapters.values())].flatMap((adapter) => adapter.list());
  }
  rawRecords() {
    return [...new Set(this.adapters.values())].flatMap((adapter) => [...adapter.rawRecords()]);
  }
  view(record) { return this.adapterForRecord(record).view(record); }
  async stop(id) {
    const record = this.get(id);
    if (!record) return false;
    await this.adapterForRecord(record).close(id);
    return true;
  }
}
