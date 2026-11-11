// `:id` is the environment's node id.
export function registerPersonBrowserRoutes(app, { personBrowsers }) {
  const failed = (response, error) => response.status(error.status || 502).json({ error: "person_browser_unavailable", message: error.message });
  app.get("/v0/person-browsers", async (_request, response) => {
    const environments = await personBrowsers.environments();
    response.json({ environments: await Promise.all(environments.map(async ({ nodeId, name, online }) => ({ id: nodeId, name, online,
      ...await personBrowsers.reach({ nodeId, local: environments.find((item) => item.nodeId === nodeId).local }).status()
        .catch((error) => ({ available: false, browsers: [], pairing: null, error: error.message })) }))) });
  });
  app.post("/v0/person-browsers/:id/pair", async (request, response) => {
    try { response.json(await (await personBrowsers.byId(request.params.id)).pair()); } catch (error) { failed(response, error); }
  });
  app.post("/v0/person-browsers/:id/launch", async (request, response) => {
    try { response.json(await (await personBrowsers.byId(request.params.id)).launch()); } catch (error) { failed(response, error); }
  });
  app.delete("/v0/person-browsers/:id/browsers/:browser", async (request, response) => {
    try { response.json(await (await personBrowsers.byId(request.params.id)).unpair(request.params.browser)); } catch (error) { failed(response, error); }
  });
}
