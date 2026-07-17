/**
 * Global runtime fan-out: snapshot-first, low-frequency process updates.
 * Subscribers are SSE/WS response streams; browser disconnect does not stop Pi.
 */

export class RuntimeHub {
  constructor({ listViews } = {}) {
    this.listViews = listViews || (() => []);
    this.clients = new Set();
  }

  snapshot() {
    return {
      type: "runtime_global_snapshot",
      processes: this.listViews(),
      at: new Date().toISOString(),
    };
  }

  attach(client) {
    this.clients.add(client);
    this.send(client, this.snapshot());
    return () => this.clients.delete(client);
  }

  publish(event) {
    if (!event || typeof event !== "object") return;
    const payload = JSON.stringify(event);
    for (const client of this.clients) this.write(client, payload);
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
