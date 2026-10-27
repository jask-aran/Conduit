/**
 * Web Push subscriptions and delivery.
 *
 * GET    /v0/push                       the public key and subscriptions
 * POST   /v0/push/subscriptions         add or update a subscription
 * DELETE /v0/push/subscriptions/:id     remove a subscription
 * POST   /v0/push/test                  send a test notification
 */
export function registerPushRoutes(app, { push, hubId }) {
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
