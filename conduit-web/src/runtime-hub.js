/**
 * Global runtime fan-out: snapshot-first, low-frequency process updates.
 * Subscribers are SSE/WS response streams; browser disconnect does not stop Pi.
 */

export class RuntimeHub {
  constructor({ listViews } = {}) {
    this.listViews = listViews || (() => []);
    this.clients = new Set();
    /** The restart being prepared: who it waits for, and who is ready. */
    this.restart = null;
  }

  snapshot() {
    return {
      type: "runtime_global_snapshot",
      processes: this.listViews(),
      ...(this.restart ? { restartPrepared: true, restartAttempt: this.restart.attempt, restartTarget: this.restart.target } : {}),
      at: new Date().toISOString(),
    };
  }

  /**
   * `peer` is what the connection said about itself: its client kind, build
   * and, for a browser, the id its tabs share for one service-worker
   * registration. Scoped to this live connection -- not a device registry.
   */
  attach(client, peer = {}) {
    client.peer = { kind: peer.kind || "browser", build: peer.build || "", registration: peer.registration || "", connectedAt: new Date().toISOString() };
    this.clients.add(client);
    this.send(client, this.snapshot());
    return () => this.clients.delete(client);
  }

  publish(event) {
    if (!event || typeof event !== "object") return;
    const payload = JSON.stringify(event);
    for (const client of this.clients) this.write(client, payload);
  }

  /** The live connections, as Settings and the CLI show them. */
  connections() {
    return [...this.clients].map((client) => ({ ...client.peer }));
  }

  /**
   * A restart to `target` (the new service worker's hash) is coming. The
   * browsers connected now are the ones it waits for, each registration once
   * however many tabs it has open; later arrivals are told but not waited on,
   * and native clients never hold it.
   */
  prepareRestart({ attempt, target } = {}) {
    if (!attempt || this.restart?.attempt === attempt) return this.restartStatus();
    const eligible = new Set(this.connections().filter((peer) => peer.kind === "browser" && peer.registration).map((peer) => peer.registration));
    this.restart = { attempt, target: target || "", eligible, ready: new Set() };
    this.publish({ type: "pwa_restart_prepared", attempt, target: target || "", at: new Date().toISOString() });
    return this.restartStatus();
  }

  /** Counts only for the attempt and target it names, from a registration waited on. */
  acknowledgeRestart({ attempt, target, registration } = {}) {
    const restart = this.restart;
    if (!restart || attempt !== restart.attempt || (target || "") !== restart.target || !restart.eligible.has(registration)) return false;
    restart.ready.add(registration);
    return true;
  }

  /** Who is still holding the restart: waited-on registrations that are connected and not ready. */
  restartStatus() {
    const restart = this.restart;
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
