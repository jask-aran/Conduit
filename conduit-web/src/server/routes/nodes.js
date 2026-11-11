/**
 * A device (a PC, a phone) groups nodes (its Windows host, a WSL distro), each paired on its own with a key returned
 * once; the hub keeps only the key's hash.
 */
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { createMachineReadout } from "../machine-readout.js";
import { servedMagicDnsOrigin } from "../../tailscale-share.js";

/** Every way a device may dial this hub, best first. */
export async function hubRoutes({ config, lanNames = () => [] }) {
  const publicUrl = process.env.CONDUIT_NODES_PUBLIC === "1" && process.env.CONDUIT_PUBLIC_URL
    ? (/^https?:\/\//.test(process.env.CONDUIT_PUBLIC_URL) ? process.env.CONDUIT_PUBLIC_URL : `https://${process.env.CONDUIT_PUBLIC_URL}`) : null;
  const tailnet = await servedMagicDnsOrigin().catch(() => null);
  const lan = lanNames().filter((name) => !name.startsWith("*.")).map((name) => `https://${name}:${config.port}`);
  return [...new Set([tailnet, ...lan, publicUrl].filter(Boolean))];
}

export function registerNodeRoutes(app, { nodeHub, config, lanNameMatches = () => false, lanNames = () => [] }) {
  // An older node does not serve the machine readout: 501, and the page says to update it.
  const readHub = createMachineReadout({ root: config.dataRoot });
  app.get("/v0/nodes/:id/machine", async (request, response) => {
    if (nodeHub.hub?.nodeId === request.params.id) return response.json(await readHub());
    if (!await nodeHub.get(request.params.id)) return response.status(404).json({ error: "node_not_found" });
    const result = await nodeHub.call(request.params.id, { target: "machine", method: "read", args: [], cwd: null },
      withAbortSignal(AbortSignal.timeout(10_000), BACKGROUND_CONTEXT)).catch((error) => ({ ok: false, error }));
    if (result?.ok) return response.json(result.value);
    response.status(result?.error?.code === "not_supported" || /not served/.test(result?.error?.message || "") ? 501 : 503)
      .json({ error: result?.error?.message || "The device did not answer" });
  });
  app.get("/v0/nodes", async (_request, response, next) => {
    response.json({ devices: await nodeHub.listDevices() });
  });

  app.post("/v0/nodes", async (request, response) => {
    const { node, device, key } = await nodeHub.pair({ name: request.body?.name,
      deviceId: request.body?.deviceId || null, deviceName: request.body?.deviceName || null });
    const known = await hubRoutes({ config, lanNames });
    const tailnet = known.filter((route) => new URL(route).hostname.endsWith(".ts.net"));
    // For a device on this network but not the tailnet: the LAN name over HTTPS, or a private address over the plain
    // HTTP the same port answers.
    const host = String(request.hostname || "");
    const lan = lanNameMatches(host) ? `https://${request.headers.host}`
      : /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(host) ? `http://${host}:${config.port}` : null;
    // The first route is the pairing's name.
    const routes = [...new Set([request.body?.mainUrl, ...tailnet, lan, ...known].filter(Boolean).map(String))];
    if (!routes.length) routes.push(`http://127.0.0.1:${config.port}`);
    const main = routes[0];
    const via = routes.slice(1).map((route) => ` --via ${route}`).join("");
    response.status(201).json({ node, device, key, mainUrl: main, routes, command: `conduit-node pair ${main} ${key}${via}` });
  });

  app.patch("/v0/devices/:id", async (request, response, next) => {
    await nodeHub.renameDevice(request.params.id, request.body?.name); response.status(204).end();
  });

  app.delete("/v0/nodes/:id", async (request, response) => {
    if (!await nodeHub.get(request.params.id)) return response.status(404).json({ error: "node_not_found" });
    await nodeHub.forget(request.params.id);
    response.status(204).end();
  });
}
