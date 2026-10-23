/**
 * This computer as a client that makes folders available, in the desktop app: its companion (node_companion.rs)
 * paired with the hub this app uses and the folders it shares, picked with the system's picker. Settings › Devices
 * and New workspace both go through here, so pairing and sharing are one thing wherever they start.
 */
import { api } from "../api/client.ts";
import { httpUrl } from "../api/transport.js";
import { desktopShell, type CompanionStatus } from "./installed-client.ts";

type Listed = { devices: Array<{ nodes: Array<{ id: string; online: boolean; browse?: boolean; roots: Array<{ label: string }> }> }> };
type ListedNode = Listed["devices"][number]["nodes"][number];

const nodes = async () => (await api<Listed>("/v0/nodes")).devices.flatMap((device) => device.nodes);

/** This computer's pairing with the hub in use, made if there is none, and its node serving. */
async function paired() {
  const app = desktopShell!;
  const pairing = pairingWith(await app.companion.status(), (await nodes()).map((node) => node.id));
  const target = pairing?.nodeId && pairing.mainUrl ? { nodeId: pairing.nodeId, mainUrl: pairing.mainUrl } : await pairThisComputer(await app.companion.status());
  const settings = await app.settings();
  if (!settings.serveAsDevice) await app.saveSettings({ ...settings, serveAsDevice: true });
  return target;
}

/** The node restarts to take a change; its hello says when it has. Asked until `ready` says so, for a while. */
async function until(nodeId: string, ready: (node: ListedNode) => boolean, failure: string) {
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    const node = (await nodes().catch(() => [])).find((item) => item.id === nodeId);
    if (node?.online && ready(node)) return;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new Error(failure);
}

/**
 * The URL this app reaches the hub by, when a node could dial it too: this machine's, over the plain HTTP the port
 * also answers (a node cannot check the self-signed certificate its HTTPS presents), or the tailnet's. Anything else
 * is left to the hub, which names the LAN or tailnet address the request came in by.
 */
export function dialableServer(): string | undefined {
  const url = new URL(httpUrl("/"), location.href);
  const host = url.hostname;
  const tailnet = /\.ts\.net$/i.test(host) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host);
  if (["127.0.0.1", "localhost", "[::1]"].includes(host)) return `http://${url.host}`;
  return tailnet ? url.origin : undefined;
}

export const thisPlatform = () => /Windows/i.test(navigator.userAgent) ? "Windows" : /Mac/i.test(navigator.userAgent) ? "macOS" : "Linux";

/** This computer's pairing with the hub in use, found by the node id it gave: the URL a pairing dials may not be the one this app uses. */
export function pairingWith(status: CompanionStatus | null, nodeIds: Iterable<string>) {
  const known = new Set(nodeIds);
  return status?.node?.pairings.find((item) => item.nodeId && known.has(item.nodeId)) || null;
}

/** Pair this computer's companion with the hub in use and start it, sharing nothing yet. */
export async function pairThisComputer(status: CompanionStatus | null) {
  const shell = desktopShell!;
  const deviceName = status?.node?.name || status?.node?.host || "This computer";
  const paired = await api<{ node: { id: string }; key: string; mainUrl: string; routes?: string[] }>("/v0/nodes", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceName, name: thisPlatform(), mainUrl: dialableServer() }),
  });
  await shell.companion.pair(paired.mainUrl, paired.key, paired.node.id, deviceName, (paired.routes || []).slice(1));
  // Pairing is asking to share: the node starts with it.
  const settings = await shell.settings();
  if (!settings.serveAsDevice) await shell.saveSettings({ ...settings, serveAsDevice: true });
  return { nodeId: paired.node.id, mainUrl: paired.mainUrl };
}

/**
 * A folder of this computer made available to the hub, from wherever the person is: paired first if it is not, the
 * system's picker for the folder, then waiting for the node to say it shares it. Null when the picker was dismissed.
 */
export async function makeFolderAvailable({ write = true, shell = true } = {}): Promise<{ nodeId: string; path: string } | null> {
  const target = await paired();
  const path = await desktopShell!.companion.share(target.mainUrl, write, shell);
  if (!path) return null;
  const same = (label: string) => label.replace(/[\\/]+$/, "").toLowerCase() === path.replace(/[\\/]+$/, "").toLowerCase();
  await until(target.nodeId, (node) => node.roots.some((root) => same(root.label)), "This computer did not start sharing that folder. Check Settings › Devices.");
  return { nodeId: target.nodeId, path };
}
