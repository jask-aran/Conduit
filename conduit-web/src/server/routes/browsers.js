/** The hub's browser (browser-host.js): what it shows, and what a Browser pane's bar asks of it. Its stream is an upgrade. */
export function registerBrowserRoutes(app, { browserHost }) {
  app.get("/v0/browsers/:id", async (request, response) => {
    if (!browserHost.has(request.params.id)) return response.status(404).json({ error: "browser_not_found" });
    try { response.json(await browserHost.status()); }
    catch (error) { response.status(error.status || 500).json({ error: error.message }); }
  });
  app.post("/v0/browsers/:id/actions", async (request, response) => {
    if (!browserHost.has(request.params.id)) return response.status(404).json({ error: "browser_not_found" });
    const { action, value } = request.body || {};
    try { await browserHost.act(String(action || ""), value); response.json(await browserHost.status()); }
    catch (error) { response.status(error.status || 500).json({ error: error.message }); }
  });
}
