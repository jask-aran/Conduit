import { takeAnswerToken } from "../../agent/answer-tokens.js";

/**
 * Web Push subscriptions and delivery.
 *
 * GET    /v0/push                       the public key and subscriptions
 * POST   /v0/push/subscriptions         add or update a subscription
 * DELETE /v0/push/subscriptions/:id     remove a subscription
 * POST   /v0/push/test                  send a test notification
 */
export function registerPushRoutes(app, { push, hubId, backends, hostUi, lifecycle, launchLiveSession }) {
  async function answerApproval({ chatId, requestId }, choice) {
    const cold = !backends.getByChatId(chatId);
    if (cold) {
      try { await launchLiveSession({ chatId }); } catch { return 409; }
    }
    const open = () => hostUi.pending().some((item) => item.chatId === chatId && item.request.id === requestId);
    // A waiting durable ask resumes after the adapter registers its asker: its card comes back within moments.
    for (let waited = 0; cold && !open() && waited < 5000; waited += 100) await new Promise((resolve) => setTimeout(resolve, 100));
    return lifecycle.run(chatId, async () => {
      const record = backends.getByChatId(chatId);
      if (!record || !open()) return cold ? 409 : 404;
      await backends.adapterForRecord(record).respondHostUi(record.id, {
        id: requestId, answers: [{ questionId: "q1", optionIds: [choice] }],
      });
      return 204;
    });
  }

  app.post("/v0/push/answer/:token", async (request, response, next) => {
    try {
      const { choice } = request.body || {};
      if (choice !== "allow" && choice !== "deny") return response.status(400).end();
      const entry = takeAnswerToken(request.params.token);
      if (!entry) return response.status(404).end();
      const status = await answerApproval(entry, choice);
      return response.status(status).end();
    } catch (error) { next(error); }
  });

  app.get("/v0/push", (request, response, next) => {
    try { response.json({ publicKey: push.publicKey(), subscriptions: push.list() }); }
    catch (error) { next(error); }
  });

  app.post("/v0/push/subscriptions", async (request, response, next) => {
    try { response.status(201).json(await push.add(request.body)); }
    catch (error) { next(error); }
  });

  app.delete("/v0/push/subscriptions/:id", async (request, response, next) => {
    try {
      if (await push.remove(request.params.id)) response.status(204).end();
      else response.status(404).json({ error: "not_found" });
    } catch (error) { next(error); }
  });

  app.post("/v0/push/test", async (request, response, next) => {
    try {
      if (request.body !== undefined && (!request.body || typeof request.body !== "object" || Array.isArray(request.body))) {
        throw Object.assign(new Error("invalid_body"), { status: 400, code: "invalid_body" });
      }
      const id = request.body?.id;
      if (id !== undefined && (typeof id !== "string" || !id)) {
        throw Object.assign(new Error("invalid_id"), { status: 400, code: "invalid_id" });
      }
      response.json(await push.send({ v: 1, title: "Conduit", body: "Notifications work on this device.", path: "/", tag: "conduit-test", hub: hubId?.(), urgency: "normal" }, id === undefined ? {} : { only: [id] }));
    } catch (error) { next(error); }
  });
}
