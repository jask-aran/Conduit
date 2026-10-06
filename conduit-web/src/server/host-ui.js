import { isChatId } from "../chat-store.js";

// How long a headless run waits on an approval or question nobody answers.
export const RUN_HOST_UI_TIMEOUT_MS = 10 * 60_000;

/**
 * A harness's questions and approval requests, answerable from anywhere.
 *
 * Every adapter states what it is waiting on as `hostUiRequests` in its process
 * view, and those views already reach every page on the global runtime
 * channel. This lists them across chats and answers one by id over HTTP, through
 * the same lock and adapter mapping as the composer's card, so a dashboard, a
 * notification or a headless caller can answer what used to need the chat open.
 *
 * A run has nobody watching by default, so a request in one is given a
 * deadline: unanswered, it is cancelled, as a dismissed card would be. The
 * deadline is a timer in the session's own scope, cleared when the request is
 * answered and gone with the session if it ends first.
 */
export function createHostUi({ backends, registry, respondHostUi }) {
  // record -> request ids already given a deadline
  const timed = new WeakMap();

  // Every live record with the view its adapter gives it, which is where a
  // harness says what it waits on.
  const views = () => backends.rawRecords().map((record) => ({ record, view: backends.view(record) }));

  /**
   * Give each request a run is waiting on its deadline, and drop the deadline
   * of one that has been answered. Swept rather than told: harnesses differ in
   * whether asking announces a process change, and a sweep reads them alike.
   */
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

  /** Everything any agent is waiting on, with where it is. */
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

    app.post("/v0/chats/:chatId/host-ui/:requestId", async (request, response, next) => {
      try {
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
      } catch (error) { next(error); }
    });
  }

  return { sweep, pending, registerRoutes };
}
