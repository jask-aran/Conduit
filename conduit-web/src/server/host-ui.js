import { isChatId } from "../chat-store.js";

const RUN_HOST_UI_TIMEOUT_MS = 10 * 60_000;

/**
 * A run has nobody watching, so a request in one is given a deadline: unanswered, it is cancelled, as a dismissed card
 * would be.
 */
export function createHostUi({ backends, registry, respondHostUi }) {
  const timed = new WeakMap();

  const views = () => backends.rawRecords().map((record) => ({ record, view: backends.view(record) }));

  /** Swept rather than told: harnesses differ in whether asking announces a process change. */
  function sweep() {
    for (const { record, view } of views()) watch(view, record);
  }

  function watch(view, record) {
    const chat = record?.chatId ? registry.metadata(record.chatId) : null;
    if (!chat?.run || !record.scope) return;
    const pending = new Set((view?.hostUiRequests || []).map((request) => request.id));
    const known = timed.get(record) || new Set();
    timed.set(record, known);
    for (const id of known) {
      if (pending.has(id)) continue;
      known.delete(id);
      record.scope.clear(`host-ui:${id}`);
    }
    const timeoutMs = Number(chat.run.hostUiTimeoutMs) || RUN_HOST_UI_TIMEOUT_MS;
    for (const id of pending) {
      if (known.has(id)) continue;
      known.add(id);
      record.scope.timeout(`host-ui:${id}`, timeoutMs, () => {
        console.warn("A run's request went unanswered; cancelling it", { chatId: chat.id, requestId: id, timeoutMs });
        void respondHostUi(chat.id, { id, cancelled: true })
          .catch((error) => console.warn("Could not cancel an unanswered request", error.message));
      });
    }
  }

  function pending() {
    return views().flatMap(({ view }) => {
      if (!view.chatId || !view.hostUiRequests?.length) return [];
      const chat = registry.metadata(view.chatId);
      return view.hostUiRequests.map((request) => ({
        chatId: view.chatId, projectId: chat?.projectId || view.projectId || null,
        title: chat?.title || "", run: Boolean(chat?.run), request,
      }));
    });
  }

  function registerRoutes(app) {
    app.get("/v0/host-ui", (_request, response) => response.json({ requests: pending() }));

    app.post("/v0/chats/:chatId/host-ui/:requestId", async (request, response) => {
      const { chatId, requestId } = request.params;
      if (!isChatId(chatId)) return response.status(404).json({ error: "chat_not_found" });
      const open = pending().some((item) => item.chatId === chatId && item.request.id === requestId);
      if (!open) return response.status(404).json({ error: "host_ui_request_not_found" });
      const body = request.body || {};
      await respondHostUi(chatId, {
        id: requestId,
        ...(body.cancelled ? { cancelled: true }
          : typeof body.confirmed === "boolean" ? { confirmed: body.confirmed }
            : body.value != null ? { value: String(body.value) } : {}),
      });
      response.status(204).end();
    });
  }

  return { sweep, pending, registerRoutes };
}
