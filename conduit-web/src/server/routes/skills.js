export function registerSkillRoutes(app, { skills }) {
  const fail = (response, next) => (error) => error.status ? response.status(error.status).json({ error: error.message }) : next(error);
  app.get("/v0/skills", async (_request, response, next) => {
    try { response.json({ skills: await skills.list() }); } catch (error) { fail(response, next)(error); }
  });
  app.get("/v0/skills/search", async (request, response, next) => {
    try { response.json({ results: await skills.search(request.query.q, Number(request.query.limit) || 20) }); }
    catch (error) { fail(response, next)(error); }
  });
  app.post("/v0/skills/install", async (request, response, next) => {
    try { response.status(201).json(await skills.install(request.body?.source, request.body?.skillId)); }
    catch (error) { fail(response, next)(error); }
  });
  app.patch("/v0/skills/:id", async (request, response, next) => {
    try {
      if (typeof request.body?.enabled !== "boolean") return response.status(400).json({ error: "Say enabled: true or false" });
      await skills.setEnabled(request.params.id, request.body.enabled);
      response.json({ skills: await skills.list() });
    } catch (error) { fail(response, next)(error); }
  });
  app.delete("/v0/skills/:id", async (request, response, next) => {
    try { await skills.remove(request.params.id); response.status(204).end(); } catch (error) { fail(response, next)(error); }
  });
}
