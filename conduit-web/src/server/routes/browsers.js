/**
 * The browsers a client can open (browser-host.js): the hub's (`hub`) and each connected device's that offers one (its
 * node id) -- what one shows, what a Browser pane's bar asks of it, Services › Browser's settings. Streams are upgrades.
 */
export function registerBrowserRoutes(app, { browsers, proxy }) {
  const pick = (request, response) => {
    const browser = browsers.get(request.params.id);
    if (!browser) response.status(404).json({ error: "browser_not_found" });
    return browser;
  };
  const answer = (work) => async (request, response) => {
    const browser = pick(request, response);
    if (!browser) return;
    try { response.json(await work(browser, request)); }
    catch (error) { response.status(error.status || 500).json({ error: error.message }); }
  };
  app.get("/v0/browsers", async (_request, response) => response.json({ browsers: await browsers.list() }));
  app.post("/v0/browsers/proxy/open", async (request, response) => {
    // The proxy for the origin Conduit is open at, while Direct pages is on (server.js).
    const found = proxy?.(request);
    if (!found) return response.status(404).json({ error: "proxy_off" });
    try { response.json(await found.open(request.body?.url)); }
    catch (error) { response.status(400).json({ error: error.message }); }
  });
  app.get("/v0/browsers/:id", answer((browser) => browser.status()));
  app.get("/v0/browsers/:id/settings", answer((browser) => browser.describe()));
  app.put("/v0/browsers/:id/settings", answer((browser, request) => browser.configure(request.body || {})));
  app.post("/v0/browsers/:id/actions", answer(async (browser, request) => {
    const { action, value } = request.body || {};
    await browser.act(String(action || ""), value);
    return browser.status();
  }));
}
