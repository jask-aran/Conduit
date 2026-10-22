import { assertChatBackendAdapter } from "./chat-backend-contract.js";
import { detect } from "./harnesses/probe.js";

export function isGeneratingRecord(record) {
  if (!record || !["starting", "running"].includes(record.status)) return false;
  // Most adapters claim a turn by setting active. Codex waits for the
  // app-server's turn/started, so between sending turn/start and hearing it
  // the turn is `turnStarting`. (Not `answering`: several adapters keep the
  // prompt they last answered there, and it read as a turn that never ended.)
  if (record.active || record.stopping || record.compacting || record.retrying || record.turnStarting) return true;
  if ((record.hostUiRequests || []).length) return true;
  return Boolean(record.generation && !record.generation.closed && !record.generation.settled);
}

export class ChatBackendRegistry {
  constructor(adapters = null) {
    this.adapters = new Map();
    this.local = new Set();
    this.manifests = new Map();
    this.detection = new Map();
    if (adapters) {
      for (const [implementation, adapter] of adapters) {
        this.adapters.set(implementation, assertChatBackendAdapter(adapter, implementation));
        this.local.add(implementation);
      }
    }
  }

  /** Register built-in adapters and detected installations, plus device-only adapters. */
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
      const here = manifest.builtIn || Boolean(detection.get(manifest.id)?.available);
      if (!here && !manifest.devices) continue;
      const adapter = assertChatBackendAdapter(manifest.build(config), manifest.id, manifest.capabilities);
      for (const implementation of implementations) {
        this.adapters.set(implementation, adapter);
        this.manifests.set(implementation, manifest);
        if (here) this.local.add(implementation);
      }
    }
  }

  async refreshDetection(manifests = this.manifestList, config = this.config) {
    if (!manifests) return this.detection;
    this.detection = await detect(manifests, config);
    this.register(manifests, this.detection, config);
    return this.detection;
  }

  manifestFor(implementation) { return this.manifests.get(implementation) || null; }
  where(predicate) { return [...this.manifests].filter(([, manifest]) => predicate(manifest)).map(([implementation]) => implementation); }

  forImplementation(implementation) {
    const adapter = this.adapters.get(implementation);
    if (!adapter) throw Object.assign(new Error("Chat backend is unavailable"), { code: "backend_unavailable", status: 409 });
    return adapter;
  }

  forChat(chat) {
    const implementation = chat?.backend?.implementation || "conduit-runtime";
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

  instances() { return [...new Set(this.adapters.values())]; }
  list() { return this.instances().flatMap((adapter) => adapter.list()); }
  rawRecords() { return this.instances().flatMap((adapter) => [...adapter.rawRecords()]); }
  generatingRecords() { return this.rawRecords().filter(isGeneratingRecord); }

  async shutdown() {
    const stopped = new Map();
    for (const adapter of this.instances()) {
      const records = [...adapter.rawRecords()];
      await Promise.all(records.map((record) => adapter.close(record.id)));
      await adapter.shutdownResources?.();
      stopped.set(adapter, records.length);
    }
    return stopped;
  }

  view(record) { return this.adapterForRecord(record).view(record); }

  async stop(id) {
    const record = this.get(id);
    if (!record) return false;
    const adapter = this.adapterForRecord(record);
    await (adapter.stopProcess ? adapter.stopProcess(id) : adapter.close(id));
    return true;
  }
}
