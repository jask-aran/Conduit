/**
 * Devices paired with this server (the node role, plan milestone 3).
 *
 * Pairing returns the device's key once, with the command that starts the
 * node role on it; main keeps only the key's hash. The list says which
 * devices are connected and what each shares.
 */
export function registerNodeRoutes(app, { nodeHub, config }) {
  app.get("/v0/nodes", async (_request, response, next) => {
    try { response.json({ nodes: await nodeHub.list() }); } catch (error) { next(error); }
  });

  app.post("/v0/nodes", async (request, response, next) => {
    try {
      const { node, key } = await nodeHub.pair(request.body?.name);
      const main = String(request.body?.mainUrl || `http://127.0.0.1:${config.port}`);
      response.status(201).json({ node, key, command: `conduit-node pair ${main} ${key}` });
    } catch (error) { next(error); }
  });

  app.delete("/v0/nodes/:id", async (request, response, next) => {
    try {
      if (!await nodeHub.get(request.params.id)) return response.status(404).json({ error: "node_not_found" });
      await nodeHub.forget(request.params.id);
      response.status(204).end();
    } catch (error) { next(error); }
  });
}
