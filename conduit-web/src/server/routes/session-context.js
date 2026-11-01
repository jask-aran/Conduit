/** Runtime context text uses the session routes' authentication and chat lookup. */
export function registerSessionContextRoutes(app, { backends, findChatContext }) {
  app.get("/v0/sessions/:id/context/:entryId", async (request, response, next) => {
    try {
      const context = await findChatContext(request.params.id);
      const entryId = Number(request.params.entryId);
      if (!context || !Number.isSafeInteger(entryId) || entryId <= 0) return response.status(404).json({ error: "context_not_found" });
      const adapter = backends.forChat(context.chat);
      const result = await adapter.readContextEntry?.({ opaqueSession: context.chat.backend?.opaqueSession, entryId });
      if (!result) return response.status(404).json({ error: "context_not_found" });
      response.json(result);
    } catch (error) { next(error); }
  });
}
