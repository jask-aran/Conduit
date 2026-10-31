export function registerNetworkRoutes(app, { lanNames }) {
  const route = "/v0/network/lan-names";
  app.get(route, async (request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    try { response.json(await lanNames.status()); }
    catch (error) { next(error); }
  });
  app.put(route, async (request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    try { response.status(202).json(await lanNames.setup(request.body)); }
    catch (error) {
      if (error.code?.startsWith("lan_") || error.code?.startsWith("cloudflare_")) return response.status(400).json({ error: error.code, message: error.message });
      next(error);
    }
  });
  app.delete(route, async (request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    try { response.json(await lanNames.remove()); }
    catch (error) { next(error); }
  });
}
