import { randomBytes } from "node:crypto";
import { isRuntimeEvent } from "./runtime-stream-api.js";

const RESTART_PREPARED_MS = 5 * 60_000;

export class RuntimeHub {
  constructor({ listViews, listDevices } = {}) {
    this.listViews = listViews || (() => []);
    this.listDevices = listDevices || (() => []);
    this.clients = new Set();
    this.updates = null;
    this.restart = null;
    this.tap = null;
  }

  snapshot() {
    return {
      type: "runtime_global_snapshot",
      processes: this.listViews(),
      devices: this.listDevices(),
      ...(this.updates ? { updates: this.updates } : {}),
      ...(this.preparedRestart() ? { restartPrepared: true, restartAttempt: this.restart.attempt, restartTarget: this.restart.target } : {}),
      at: new Date().toISOString(),
    };
  }

  // `peer` is what the connection said about itself, scoped to this live connection: not a device registry.
  attach(client, peer = {}) {
    // Told to that connection alone, so a client can find itself in the list.
    client.peer = { id: randomBytes(6).toString("hex"), kind: peer.kind || "browser", build: peer.build || "", registration: peer.registration || "", platform: peer.platform || "", agent: peer.agent || "", connectedAt: new Date().toISOString() };
    this.clients.add(client);
    this.send(client, { ...this.snapshot(), connection: client.peer.id });
    return () => this.clients.delete(client);
  }

  offerUpdates(updates) {
    if (JSON.stringify(updates) === JSON.stringify(this.updates)) return;
    this.updates = updates;
    this.publish({ type: "updates_offered", updates, at: new Date().toISOString() });
  }

  /** @param {{ type: keyof typeof import("./runtime-stream-api.js").RUNTIME_EVENTS }} event */
  publish(event) {
    if (!event || typeof event !== "object") return;
    if (!isRuntimeEvent(event.type)) throw new TypeError(`Runtime event ${event.type} is not declared (runtime-stream-api.js)`);
    this.tap?.(event);
    const payload = JSON.stringify(event);
    for (const client of this.clients) this.write(client, payload);
  }

  // So the devices' map draws an installed client as the environment its companion runs as. Shown, never trusted.
  locate(id, nodes) {
    const client = [...this.clients].find((candidate) => candidate.peer.id === id);
    if (!client) return false;
    client.peer.nodes = (Array.isArray(nodes) ? nodes : []).filter((node) => typeof node === "string" && node.length <= 80).slice(0, 8);
    return true;
  }

  // Shown, never trusted.
  note(id, fields) {
    const client = [...this.clients].find((candidate) => candidate.peer.id === id);
    if (client) Object.assign(client.peer, fields);
  }

  sendTo(id, event) {
    if (!isRuntimeEvent(event?.type)) throw new TypeError(`Runtime event ${event?.type} is not declared (runtime-stream-api.js)`);
    const client = [...this.clients].find((candidate) => candidate.peer.id === id);
    if (!client) return false;
    this.write(client, JSON.stringify(event));
    return true;
  }

  connections() {
    return [...this.clients].map((client) => ({ ...client.peer }));
  }

  // Waits for each registration connected now, once however many tabs it has; later arrivals are told but not waited
  // on, and native clients never hold it.
  prepareRestart({ attempt, target } = {}) {
    if (!attempt || this.preparedRestart()?.attempt === attempt) return this.restartStatus();
    const eligible = new Set(this.connections().filter((peer) => peer.kind === "browser" && peer.registration).map((peer) => peer.registration));
    this.restart = { attempt, target: target || "", eligible, ready: new Set(), at: Date.now() };
    this.publish({ type: "pwa_restart_prepared", attempt, target: target || "", at: new Date().toISOString() });
    return this.restartStatus();
  }

  // A launcher that prepares and gives up leaves it standing; the launcher waits seconds, so minutes later it is not
  // coming.
  preparedRestart() {
    if (this.restart && Date.now() - this.restart.at > RESTART_PREPARED_MS) this.restart = null;
    return this.restart;
  }

  acknowledgeRestart({ attempt, target, registration } = {}) {
    const restart = this.preparedRestart();
    if (!restart || attempt !== restart.attempt || (target || "") !== restart.target || !restart.eligible.has(registration)) return false;
    restart.ready.add(registration);
    return true;
  }

  restartStatus() {
    const restart = this.preparedRestart();
    if (!restart) return null;
    const connected = new Set(this.connections().map((peer) => peer.registration).filter(Boolean));
    const waiting = [...restart.eligible].filter((registration) => connected.has(registration) && !restart.ready.has(registration));
    return { attempt: restart.attempt, target: restart.target, eligible: restart.eligible.size, ready: restart.ready.size, waiting };
  }

  publishProcess(view, reason = "update") {
    if (!view) return;
    this.publish({
      type: "runtime_process",
      reason,
      process: view,
      at: new Date().toISOString(),
    });
  }

  publishProcessRemoved(id, chatId = null) {
    this.publish({
      type: "runtime_process_removed",
      id,
      chatId,
      at: new Date().toISOString(),
    });
  }

  publishDevices() {
    this.publish({ type: "devices_changed", devices: this.listDevices(), at: new Date().toISOString() });
  }

  publishTerminal(view, reason = "update") {
    if (!view) return;
    this.publish({
      type: "terminal_changed",
      reason,
      terminal: view,
      at: new Date().toISOString(),
    });
  }

  publishTerminalRemoved(id, projectId = null) {
    this.publish({
      type: "terminal_removed",
      id,
      projectId,
      at: new Date().toISOString(),
    });
  }

  close() {
    for (const client of this.clients) {
      try {
        if (client.kind === "sse") client.response.end();
        else client.socket.close?.(1012, "Conduit is restarting");
      } catch {
        // The transport already closed.
      }
    }
    this.clients.clear();
  }

  send(client, value) {
    this.write(client, typeof value === "string" ? value : JSON.stringify(value));
  }

  write(client, payload) {
    try {
      if (client.kind === "sse") {
        if (client.response.writableEnded) {
          this.clients.delete(client);
          return;
        }
        client.response.write(`data: ${payload}\n\n`);
        return;
      }
      if (client.kind === "ws") {
        if (client.socket.readyState === client.socket.OPEN) client.socket.send(payload);
        else this.clients.delete(client);
      }
    } catch {
      this.clients.delete(client);
    }
  }
}
