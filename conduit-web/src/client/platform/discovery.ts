/**
 * What is on this network, asked once and answered by whichever shell is
 * running.
 *
 * The server publishes `_conduit._tcp` with its identity in the TXT record;
 * this is the other end of that. Android browses with `NsdManager` and the
 * desktop browses from Rust, and neither fact reaches the client -- it asks
 * `discoverServers()` and gets the same shape back, the way `isInstalledClient`
 * hides which shell holds the token.
 *
 * A browser cannot do this at all. There is no mDNS API in a page, and even
 * with one an HTTPS document cannot open a plaintext connection to a LAN
 * address. That is not a gap to be worked around later; it is why
 * `canDiscoverServers` exists, so the surface above can say so plainly instead
 * of showing a search that never finds anything.
 *
 * Nothing found here is a server. It is an address with a claimed identity,
 * and the claim is checked the same way any other address is -- `proveServer`
 * against the advertised key, before a token goes near it. A record on a
 * multicast network is written by whoever felt like writing it.
 */
import { installedClientKind } from "./installed-client.ts";
import { normalizeServerOrigin, scopeOf } from "./servers.ts";

export interface FoundServer {
  /** The instance name the server published: its machine, not its software. */
  name: string;
  /** The first of `candidates`, shown on the row. */
  origin: string;
  /**
   * Every private address it was found at. A machine on Wi-Fi and Ethernet
   * at once answers on both, and only one may reach this client.
   */
  candidates: string[];
  /** The identity id from the TXT record. A claim until it is proved. */
  id: string;
  /** The Ed25519 public half, base64 SPKI, as `proveServer` wants it. */
  publicKey: string;
}

/** What a shell hands back before the address rule below is applied. */
interface Advertisement {
  name?: unknown;
  addresses?: unknown;
  port?: unknown;
  id?: unknown;
  publicKey?: unknown;
}

const DEFAULT_TIMEOUT_MS = 3_000;

export const canDiscoverServers = () => installedClientKind !== "browser";

/**
 * The addresses of the several a host answers to that this client can use.
 *
 * A responder lists every address its machine holds -- IPv6, link-local, the
 * 169.254 one an interface gave itself when nothing else did -- and only the
 * private IPv4 ones are usable. Picking them here, once, keeps both shells
 * free of the rule.
 */
function originsFor(addresses: unknown, port: unknown): string[] {
  const numberPort = Number(port);
  if (!Number.isInteger(numberPort) || numberPort < 1 || numberPort > 65_535) return [];
  const origins: string[] = [];
  for (const address of Array.isArray(addresses) ? addresses : []) {
    if (typeof address !== "string") continue;
    // Link-local is what an interface gives itself when nothing handed it an
    // address. It reads as private and almost never reaches anything, so it
    // is left out here for the same reason the server leaves it out of the
    // paths it publishes.
    if (address.startsWith("169.254.")) continue;
    let origin: string;
    try { origin = normalizeServerOrigin(`http://${address}:${numberPort}`); } catch { continue; }
    if (scopeOf(origin) === "private" && !origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

function shape(advertisement: Advertisement): FoundServer | null {
  const candidates = originsFor(advertisement.addresses, advertisement.port);
  const origin = candidates[0];
  if (!origin) return null;
  const id = String(advertisement.id || "");
  const publicKey = String(advertisement.publicKey || "");
  // Without both of these the address cannot be proved, and an address that
  // cannot be proved is one we would have to ask the person to trust on sight.
  if (!/^[0-9a-f]{32}$/.test(id) || !publicKey) return null;
  const name = String(advertisement.name || "").trim();
  return { name: name || new URL(origin).host, origin, candidates, id, publicKey };
}

/** Both shells report each server as it resolves, then the whole set. */
async function ask(timeoutMs: number, onAdvertisement: (advertisement: Advertisement) => void): Promise<Advertisement[]> {
  if (installedClientKind === "android") {
    const { registerPlugin } = await import("@capacitor/core");
    const plugin = registerPlugin<{
      discover(options: { timeoutMs: number }): Promise<{ servers?: Advertisement[] }>;
      addListener(event: "found", listener: (advertisement: Advertisement) => void): Promise<{ remove(): Promise<void> }>;
    }>("ConduitDiscovery");
    const listener = await plugin.addListener("found", onAdvertisement).catch(() => null);
    try { return (await plugin.discover({ timeoutMs })).servers ?? []; }
    finally { void listener?.remove(); }
  }
  if (installedClientKind === "desktop") {
    const { Channel, invoke } = await import("@tauri-apps/api/core");
    const onFound = new Channel<Advertisement>();
    onFound.onmessage = onAdvertisement;
    return await invoke<Advertisement[]>("discover_servers", { timeoutMs, onFound });
  }
  return [];
}

/**
 * Browse for the length of one question and stop.
 *
 * Bounded on purpose: a standing listener would hold a multicast socket open
 * for the life of the app to answer a question nobody is asking, and on a
 * phone that is a radio kept awake. Discovery runs when a surface is showing
 * results and ends with it.
 */
export async function discoverServers({ timeoutMs = DEFAULT_TIMEOUT_MS, onFound }: {
  timeoutMs?: number;
  /** Called as each server is found, and again when it turns up at another address. */
  onFound?: (server: FoundServer) => void;
} = {}): Promise<FoundServer[]> {
  if (!canDiscoverServers()) return [];
  // One row per identity: a server that resolves on two interfaces, or twice
  // on one, is one server with every address it was found at.
  const byId = new Map<string, FoundServer>();
  const take = (advertisement: Advertisement) => {
    const found = shape(advertisement);
    if (!found) return;
    const held = byId.get(found.id);
    const candidates = held ? [...new Set([...held.candidates, ...found.candidates])] : found.candidates;
    if (held && candidates.length === held.candidates.length) return;
    const next = { ...(held ?? found), candidates };
    byId.set(found.id, next);
    onFound?.(next);
  };
  // A shell that cannot browse -- an old build, a platform without the command
  // -- is the same answer as a network with nothing on it. There is nothing
  // the person could do differently either way.
  try { (await ask(Math.min(10_000, Math.max(500, timeoutMs)), take)).forEach(take); }
  catch { /* what arrived before the failure still stands */ }
  return [...byId.values()];
}
