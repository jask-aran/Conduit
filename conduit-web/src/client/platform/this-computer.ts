/** The desktop app's companion, paired with the hub this app uses and sharing folders with it. */
import { api } from "../api/client.ts";
import { httpUrl } from "../api/transport.js";
import { desktopShell, type CompanionStatus } from "./installed-client.ts";
import type { NodesPayload } from "../api/contracts.ts";

const NODE_POLL_MS = 700;

type ListedNode = NodesPayload["devices"][number]["nodes"][number];

const nodes = async () => (await api<NodesPayload>("/v0/nodes")).devices.flatMap((device) => device.nodes);

async function paired() {
  const app = desktopShell!;
  const pairing = pairingWith(await app.companion.status(), (await nodes()).map((node) => node.id));
  const existing = pairing?.nodeId && pairing.mainUrl ? { nodeId: pairing.nodeId, mainUrl: pairing.mainUrl } : null;
  const target = existing || await pairThisComputer(await app.companion.status());
  if (existing) {
    const settings = await app.settings();
    if (!settings.serveAsDevice) await app.saveSettings({ ...settings, serveAsDevice: true });
  }
  return target;
}

/** A paired computer's companion runs whenever the app does; unpaired from everything, it stops. */
export async function keepThisComputerConnected() {
  const shell = desktopShell;
  if (!shell) return;
  const [status, settings] = await Promise.all([shell.companion.status(), shell.settings()]);
  const paired = Boolean(status?.node?.pairings.length);
  if (paired !== settings.serveAsDevice) await shell.saveSettings({ ...settings, serveAsDevice: paired });
}

async function until(nodeId: string, ready: (node: ListedNode) => boolean, failure: string) {
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    const node = (await nodes().catch(() => [])).find((item) => item.id === nodeId);
    if (node?.online && ready(node)) return;
    await new Promise((resolve) => setTimeout(resolve, NODE_POLL_MS));
  }
  throw new Error(failure);
}

/**
 * Loopback goes as plain HTTP because a node cannot check the hub's self-signed certificate. Anything but loopback
 * or the tailnet is left to the hub, which names the address the request came in by.
 */
export function dialableServer(): string | undefined {
  const url = new URL(httpUrl("/"), location.href);
  const host = url.hostname;
  const tailnet = /\.ts\.net$/i.test(host) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host);
  if (["127.0.0.1", "localhost", "[::1]"].includes(host)) return `http://${url.host}`;
  return tailnet ? url.origin : undefined;
}

export const thisPlatform = () => /Windows/i.test(navigator.userAgent) ? "Windows" : /Mac/i.test(navigator.userAgent) ? "macOS" : "Linux";

/** Found by node id: the URL a pairing dials may not be the one this app uses. */
export function pairingWith(status: CompanionStatus | null, nodeIds: Iterable<string>) {
  const known = new Set(nodeIds);
  return status?.node?.pairings.find((item) => item.nodeId && known.has(item.nodeId)) || null;
}

export async function pairThisComputer(status: CompanionStatus | null) {
  const shell = desktopShell!;
  const deviceName = status?.node?.name || status?.node?.host || "This computer";
  const mainUrl = dialableServer();
  // On the hub's own machine (dialling it on loopback) this computer is another side of the hub's device, not a
  // device of its own.
  const onHub = Boolean(mainUrl && /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|$)/.test(mainUrl));
  const deviceId = onHub ? (await api<NodesPayload>("/v0/nodes")).devices.find((device) => device.hub)?.id : undefined;
  const paired = await api<{ node: { id: string }; key: string; mainUrl: string; routes?: string[] }>("/v0/nodes", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceName, name: thisPlatform(), mainUrl, ...(deviceId ? { deviceId } : {}) }),
  });
  await shell.companion.pair(paired.mainUrl, paired.key, paired.node.id, deviceName, (paired.routes || []).slice(1));
  const settings = await shell.settings();
  if (!settings.serveAsDevice) await shell.saveSettings({ ...settings, serveAsDevice: true });
  return { nodeId: paired.node.id, mainUrl: paired.mainUrl };
}

/** Null when the picker was dismissed. */
export async function makeFolderAvailable({ write = true, shell = true } = {}): Promise<{ nodeId: string; path: string } | null> {
  const target = await paired();
  const path = await desktopShell!.companion.share(target.mainUrl, write, shell);
  if (!path) return null;
  const same = (label: string) => label.replace(/[\\/]+$/, "").toLowerCase() === path.replace(/[\\/]+$/, "").toLowerCase();
  await until(target.nodeId, (node) => node.roots.some((root) => same(root.label)), "This computer did not start sharing that folder. Check Settings › Devices.");
  return { nodeId: target.nodeId, path };
}
