function noStore(response) {
  response.set("Cache-Control", "no-store");
}
export function registerSearchRoutes(app, { searchSettings, onSettingsChanged = async () => {} }) {
  app.get("/v0/search/settings", async (_request, response, next) => {
    try {
      noStore(response);
      response.json(await searchSettings.publicView());
    } catch (error) { next(error); }
  });

  app.put("/v0/search/providers/:providerId", async (request, response, next) => {
    try {
      const settings = await searchSettings.setProvider(request.params.providerId, request.body?.key);
      await onSettingsChanged();
      noStore(response);
      response.json(settings);
    } catch (error) { next(error); }
  });

  app.delete("/v0/search/providers/:providerId", async (request, response, next) => {
    try {
      const result = await searchSettings.removeProvider(request.params.providerId);
      await onSettingsChanged();
      noStore(response);
      response.json(result);
    } catch (error) { next(error); }
  });
}
