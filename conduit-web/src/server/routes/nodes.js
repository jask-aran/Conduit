/**
 * Devices paired with this server (the node role, plan milestone 3).
 *
 * A device (a PC, a phone) groups nodes (its Windows host, a WSL distro),
 * each paired on its own with a key returned once, inside the command that
 * starts the node role there; main keeps only the key's hash. The list is
 * devices with their nodes: connected or not, and what each shares.
 */
import { currentMagicDnsOrigin } from "../../tailscale-share.js";

export function registerNodeRoutes(app, { nodeHub, config }) {
  app.get("/v0/nodes", async (_request, response, next) => {
    try { response.json({ devices: await nodeHub.listDevices() }); } catch (error) { next(error); }
  });

  app.post("/v0/nodes", async (request, response, next) => {
    try {
      const { node, device, key } = await nodeHub.pair({ name: request.body?.name,
        deviceId: request.body?.deviceId || null, deviceName: request.body?.deviceName || null });
      // Devices reach main over the tailnet (decision 4): its MagicDNS name when
      // Tailscale serves it; else its public address, when devices may use it;
      // else this machine, for a node on the same one.
      const publicUrl = process.env.CONDUIT_NODES_PUBLIC === "1" && process.env.CONDUIT_PUBLIC_URL
        ? (/^https?:\/\//.test(process.env.CONDUIT_PUBLIC_URL) ? process.env.CONDUIT_PUBLIC_URL : `https://${process.env.CONDUIT_PUBLIC_URL}`) : null;
      const main = String(request.body?.mainUrl || await currentMagicDnsOrigin().catch(() => null) || publicUrl || `http://127.0.0.1:${config.port}`);
      response.status(201).json({ node, device, key, mainUrl: main, command: `conduit-node pair ${main} ${key}` });
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
