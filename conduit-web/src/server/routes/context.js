export function registerContextRoutes(app, { contextStore }) {
  const route = (handler, changes = false) => async (request, response, next) => {
    try { await handler(request, response); if (changes) contextStore.changed?.(); }
    catch (error) {
      if (!error.status) return next(error);
      response.status(error.status).json({ error: error.message, ...(error.usedBy ? { usedBy: error.usedBy } : {}) });
    }
  };
  app.get("/v0/context", route(async (_req, res) => res.json(await contextStore.list())));
  app.get("/v0/context/blocks/:id", route(async (req, res) => res.json(await contextStore.get(req.params.id))));
  app.put("/v0/context/blocks/:id", route(async (req, res) => res.json(await contextStore.save(req.params.id, req.body)), true));
  app.post("/v0/context/blocks", route(async (req, res) => res.status(201).json(await contextStore.create(req.body)), true));
  app.delete("/v0/context/blocks/:id", route(async (req, res) => { await contextStore.remove(req.params.id); res.sendStatus(204); }, true));
  app.post("/v0/context/blocks/:id/reset", route(async (req, res) => res.json(await contextStore.reset(req.params.id)), true));
  app.put("/v0/context/documents/:id", route(async (req, res) => res.json(await contextStore.saveDocument(req.params.id, req.body)), true));
  app.post("/v0/context/documents/:id/reset", route(async (req, res) => res.json(await contextStore.resetDocument(req.params.id)), true));
  app.get("/v0/context/documents/:id/preview", route(async (req, res) => res.json(await contextStore.preview(req.params.id))));
}
