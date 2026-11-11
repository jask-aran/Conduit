/**
 * Browses for the server's `_conduit._tcp` mDNS records through the installed shell; a browser page cannot. What
 * is found is only a claimed identity, proved with `proveServer` before a token goes near it.
 */
import { installedClientKind } from "./installed-client.ts";
import { normalizeServerOrigin, scopeOf } from "./servers.ts";

export interface FoundServer {
  name: string;
  origin: string;
  /** A machine on Wi-Fi and Ethernet at once answers on both, and only one may reach this client. */
  candidates: string[];
  id: string;
  /** Base64 SPKI Ed25519 key, as `proveServer` wants it. */
  publicKey: string;
}

interface Advertisement {
  name?: unknown;
  addresses?: unknown;
  port?: unknown;
  id?: unknown;
  publicKey?: unknown;
}

const DEFAULT_TIMEOUT_MS = 3_000;

export const canDiscoverServers = () => installedClientKind !== "browser";

/** A responder lists every address its machine holds; only the private IPv4 ones are usable. */
function originsFor(addresses: unknown, port: unknown): string[] {
  const numberPort = Number(port);
  if (!Number.isInteger(numberPort) || numberPort < 1 || numberPort > 65_535) return [];
  const origins: string[] = [];
  for (const address of Array.isArray(addresses) ? addresses : []) {
    if (typeof address !== "string") continue;
    // Link-local reads as private but almost never reaches anything.
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
  // Without both the address cannot be proved.
  if (!/^[0-9a-f]{32}$/.test(id) || !publicKey) return null;
  const name = String(advertisement.name || "").trim();
  return { name: name || new URL(origin).host, origin, candidates, id, publicKey };
}

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

/** Bounded on purpose: a standing multicast listener keeps a phone's radio awake. */
export async function discoverServers({ timeoutMs = DEFAULT_TIMEOUT_MS, onFound }: {
  timeoutMs?: number;
  /** Called as each server is found, and again when it turns up at another address. */
  onFound?: (server: FoundServer) => void;
} = {}): Promise<FoundServer[]> {
  if (!canDiscoverServers()) return [];
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
  // A shell that cannot browse is the same answer as a network with nothing on it.
  try { (await ask(Math.min(10_000, Math.max(500, timeoutMs)), take)).forEach(take); }
  catch { /* what arrived before the failure still stands */ }
  return [...byId.values()];
}
