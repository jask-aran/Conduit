import { timingSafeEqual } from "node:crypto";
import { decide } from "../../agent/asks.js";

export function registerPushRoutes(app, { push, hubId, agent }) {
  app.post("/v0/push/answer/:token", async (request, response, next) => {
    try {
      const { choice } = request.body || {};
      if (choice !== "allow" && choice !== "always" && choice !== "deny") return response.status(400).end();
      if (!agent) return response.status(404).end();
      // Deciding the ask once is what makes the token single-use.
      const token = Buffer.from(String(request.params.token));
      const matches = (id) => { const mine = Buffer.from(push.answerToken(id)); return mine.length === token.length && timingSafeEqual(mine, token); };
      const askId = Object.keys((await agent.state()).asks || {}).find(matches);
      if (!askId) return response.status(404).end();
      await decide(agent, askId, choice);
      return response.status(204).end();
    } catch (error) { if ([400, 404, 409].includes(error.status)) return response.status(error.status).end(); next(error); }
  });

  app.get("/v0/push", (request, response, next) => {
    response.json({ publicKey: push.publicKey(), subscriptions: push.list() });
  });

  app.post("/v0/push/subscriptions", async (request, response, next) => {
    response.status(201).json(await push.add(request.body));
  });

  app.delete("/v0/push/subscriptions/:id", async (request, response) => {
    if (await push.remove(request.params.id)) response.status(204).end();
    else response.status(404).json({ error: "not_found" });
  });

  app.post("/v0/push/test", async (request, response) => {
    if (request.body !== undefined && (!request.body || typeof request.body !== "object" || Array.isArray(request.body))) {
      throw Object.assign(new Error("invalid_body"), { status: 400, code: "invalid_body" });
    }
    const id = request.body?.id;
    if (id !== undefined && (typeof id !== "string" || !id)) {
      throw Object.assign(new Error("invalid_id"), { status: 400, code: "invalid_id" });
    }
    response.json(await push.send({ v: 1, title: "Conduit", body: "Notifications work on this device.", path: "/", tag: "conduit-test", hub: hubId?.(), urgency: "normal" }, id === undefined ? {} : { only: [id] }));
  });
}
