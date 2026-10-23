/**
 * Devices paired with this server (the node role, plan milestone 3).
 *
 * A device (a PC, a phone) groups nodes (its Windows host, a WSL distro),
 * each paired on its own with a key returned once, inside the command that
 * starts the node role there; main keeps only the key's hash. The list is
 * devices with their nodes: connected or not, and what each shares.
 */
import { servedMagicDnsOrigin } from "../../tailscale-share.js";

export function registerNodeRoutes(app, { nodeHub, config, lanNameMatches = () => false }) {
  app.get("/v0/nodes", async (_request, response, next) => {
    try { response.json({ devices: await nodeHub.listDevices() }); } catch (error) { next(error); }
  });

  app.post("/v0/nodes", async (request, response, next) => {
    try {
      const { node, device, key } = await nodeHub.pair({ name: request.body?.name,
        deviceId: request.body?.deviceId || null, deviceName: request.body?.deviceName || null });
      // Devices reach main over the tailnet or this LAN (decision 4, widened 2026-10-23): its MagicDNS name when
      // Tailscale serves it; else its public address, when devices may use it;
      // else this machine, for a node on the same one.
      const publicUrl = process.env.CONDUIT_NODES_PUBLIC === "1" && process.env.CONDUIT_PUBLIC_URL
        ? (/^https?:\/\//.test(process.env.CONDUIT_PUBLIC_URL) ? process.env.CONDUIT_PUBLIC_URL : `https://${process.env.CONDUIT_PUBLIC_URL}`) : null;
      const tailnet = await servedMagicDnsOrigin().catch(() => null);
      // The LAN address this request came in by, for a device on this network but not the tailnet: the LAN name over
      // HTTPS (its certificate is a real one), or a private address over the plain HTTP the same port answers.
      const host = String(request.hostname || "");
      const lan = lanNameMatches(host) ? `https://${request.headers.host}`
        : /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(host) ? `http://${host}:${config.port}` : null;
      // Every way a device may dial, best first; the first is the pairing's name.
      const routes = [...new Set([request.body?.mainUrl, tailnet, lan, publicUrl].filter(Boolean).map(String))];
      if (!routes.length) routes.push(`http://127.0.0.1:${config.port}`);
      const main = routes[0];
      const via = routes.slice(1).map((route) => ` --via ${route}`).join("");
      response.status(201).json({ node, device, key, mainUrl: main, routes, command: `conduit-node pair ${main} ${key}${via}` });
    } catch (error) { next(error); }
  });

  app.patch("/v0/devices/:id", async (request, response, next) => {
    try { await nodeHub.renameDevice(request.params.id, request.body?.name); response.status(204).end(); } catch (error) { next(error); }
  });

  app.delete("/v0/nodes/:id", async (request, response, next) => {
    try {
      if (!await nodeHub.get(request.params.id)) return response.status(404).json({ error: "node_not_found" });
      await nodeHub.forget(request.params.id);
      response.status(204).end();
    } catch (error) { next(error); }
  });
}
