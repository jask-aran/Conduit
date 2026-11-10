function noStore(response) {
  response.set("Cache-Control", "no-store");
}
export function registerSearchRoutes(app, { searchSettings }) {
  app.get("/v0/search/settings", async (_request, response) => {
    noStore(response);
    response.json(await searchSettings.publicView());
  });

  app.patch("/v0/search/settings", async (request, response) => {
    const settings = await searchSettings.update(request.body || {});
    noStore(response);
    response.json(settings);
  });

  app.put("/v0/search/providers/:providerId", async (request, response) => {
    const settings = await searchSettings.setProvider(request.params.providerId, request.body?.key);
    noStore(response);
    response.json(settings);
  });

  app.delete("/v0/search/providers/:providerId", async (request, response) => {
    const result = await searchSettings.removeProvider(request.params.providerId);
    noStore(response);
    response.json(result);
  });
}
