import { rememberView } from "./resume-view.ts";
import { createEffect, createSignal, on } from "solid-js";
import { installedClientKind, isInstalledClient } from "./installed-client.ts";
import { publishTrustedIdentities, type TrustedIdentity } from "./certificate-pins.ts";
import { LOOPBACK_HOST, PRIVATE_HOST } from "../../network-hosts.js";
import { resolveHost } from "./resolve-host.ts";

/**
 * Two addresses that reach one machine are two servers until both answer with the same id over an authenticated
 * connection: an unauthenticated endpoint is not trusted to say which box it is.
 */
export type PathScope = "loopback" | "private" | "public";

export interface ServerPath {
  origin: string;
  scope: PathScope;
}

export interface ServerEntry {
  name: string;
  serverName?: string;
  origin: string;
  /** Absent for a server too old to answer, so nothing may depend on having it. */
  id?: string;
  /** Makes another address checkable before a token is sent to it. */
  publicKey?: string;
  /** The entry's own `origin` is not repeated here. */
  paths?: ServerPath[];
  tls?: boolean;
  /**
   * The directory is kept by the servers and every device reads it, so whether an address belongs on this machine or
   * everywhere has to be said rather than guessed.
   */
  shared: boolean;
}

export const SERVERS_STORAGE_KEY = "conduit.servers";
export const ACTIVE_SERVER_STORAGE_KEY = "conduit.servers.active";

// Plain HTTP is allowed on loopback, which never leaves the machine, and on private ranges, where no public authority
// issues a certificate for the address, so requiring HTTPS would leave a LAN server unreachable.

const hostOf = (origin: string) => { try { return new URL(origin).hostname; } catch { return ""; } };

export const isDirectOrigin = (origin: string) => {
  const host = hostOf(origin);
  return LOOPBACK_HOST.test(host) || PRIVATE_HOST.test(host);
};

/** A local address names whatever machine holds it on the reader's network, so it is not the same server elsewhere. */
export const sharedByDefault = (origin: string) => !isDirectOrigin(origin);

export function normalizeServerOrigin(value: unknown): string {
  const input = String(value || "").trim();
  // This machine's server answers plain HTTP; its HTTPS has a certificate the app cannot check by address.
  const candidate = input.includes("://") ? input : `${/^(127\.\d+\.\d+\.\d+|localhost|\[::1\])(:\d+)?$/i.test(input) ? "http" : "https"}://${input}`;
  let url: URL;
  try { url = new URL(candidate); }
  catch { throw new Error("Enter a complete HTTPS server address."); }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isDirectOrigin(url.origin))) {
    throw new Error("The server address must use HTTPS unless it is on this machine or this network.");
  }
  if (url.username || url.password) throw new Error("The server address cannot contain credentials.");
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("Enter the server origin without a path, query, or fragment.");
  return url.origin;
}

/** The host with its port: the port is often all that tells two servers on one machine apart. */
export function defaultServerName(origin: string): string {
  try { return new URL(origin).host || origin; }
  catch { return origin; }
}

interface Storageish {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storageOrNull(): Storageish | null {
  // Absent while rendering off a browser, and it throws rather than returning
  // null when site data is blocked, so both are the same answer here.
  try { return typeof localStorage === "undefined" ? null : localStorage; }
  catch { return null; }
}

const SCOPES: PathScope[] = ["loopback", "private", "public"];

function readPaths(value: unknown, self: string): ServerPath[] {
  const seen = new Set([self]);
  const paths: ServerPath[] = [];
  for (const item of Array.isArray(value) ? value as Array<Record<string, unknown>> : []) {
    let origin: string;
    try { origin = normalizeServerOrigin(item?.origin); } catch { continue; }
    if (seen.has(origin)) continue;
    seen.add(origin);
    const scope = SCOPES.includes(item?.scope as PathScope) ? item?.scope as PathScope : scopeOf(origin);
    paths.push({ origin, scope });
  }
  return paths;
}

export function scopeOf(origin: string): PathScope {
  const host = hostOf(origin);
  if (LOOPBACK_HOST.test(host)) return "loopback";
  return PRIVATE_HOST.test(host) ? "private" : "public";
}

/**
 * A name is judged by what this machine's resolver says it stands for; a page has no resolver and judges a name as
 * public. What may go over plain HTTP stays `scopeOf`'s, by the text alone.
 */
export type Reach = "loopback" | "private" | "tailnet" | "public";
const REACHES: Reach[] = ["loopback", "private", "tailnet", "public"];
// Tailscale's addresses: 100.64/10.
const TAILNET_HOST = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])(\.\d{1,3}){2}$/;
const reachOfAddress = (host: string): Reach | null => LOOPBACK_HOST.test(host) ? "loopback" : PRIVATE_HOST.test(host) ? "private"
  : TAILNET_HOST.test(host) || host.endsWith(".ts.net") ? "tailnet" : null;
const [resolvedReach, setResolvedReach] = createSignal<Record<string, Reach>>({});
const lookedUp = new Set<string>();
export function reachOf(origin: string): Reach {
  const host = hostOf(origin);
  const known = reachOfAddress(host) ?? resolvedReach()[host];
  if (known) return known;
  if (isInstalledClient() && !lookedUp.has(host)) {
    lookedUp.add(host);
    void resolveHost(host).then((addresses) => {
      const nearest = addresses.map((address) => reachOfAddress(address.replace(/^::ffff:/, "")) ?? "public")
        .sort((left, right) => REACHES.indexOf(left) - REACHES.indexOf(right))[0];
      if (nearest && nearest !== "public") setResolvedReach((all) => ({ ...all, [host]: nearest }));
    });
  }
  return "public";
}

export function serverPathLabel(path: ServerPath): string {
  return { loopback: "This machine", private: "This network", tailnet: "Tailscale", public: "Internet" }[reachOf(path.origin)];
}

export function pathsOf(entry: ServerEntry): ServerPath[] {
  const all = [{ origin: entry.origin, scope: scopeOf(entry.origin) }, ...(entry.paths ?? [])];
  return all.sort((left, right) => REACHES.indexOf(reachOf(left.origin)) - REACHES.indexOf(reachOf(right.origin)));
}

export function readServers(storage: Storageish | null): ServerEntry[] {
  const raw = storage?.getItem(SERVERS_STORAGE_KEY);
  let parsed: unknown = [];
  if (raw) { try { parsed = JSON.parse(raw); } catch { parsed = []; } }
  const seen = new Set<string>();
  const list: ServerEntry[] = [];
  for (const item of Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : []) {
    let origin: string;
    try { origin = normalizeServerOrigin(item?.origin); } catch { continue; }
    if (seen.has(origin)) continue;
    seen.add(origin);
    const name = typeof item?.name === "string" && item.name.trim() ? item.name.trim() : defaultServerName(origin);
    const serverName = typeof item?.serverName === "string" && item.serverName.trim() ? item.serverName.trim().slice(0, 63) : undefined;
    const shared = typeof item?.shared === "boolean" ? item.shared : sharedByDefault(origin);
    const id = typeof item?.id === "string" && /^[0-9a-f]{32}$/.test(item.id) ? item.id : undefined;
    const publicKey = typeof item?.publicKey === "string" && item.publicKey.length <= 128 ? item.publicKey : undefined;
    const paths = readPaths(item?.paths, origin);
    const tls = item?.tls === true && !!publicKey;
    list.push({ origin, name, shared, ...(serverName ? { serverName } : {}), ...(id ? { id } : {}), ...(publicKey ? { publicKey } : {}), ...(paths.length ? { paths } : {}), ...(tls ? { tls } : {}) });
  }
  return list;
}

export function writeServers(storage: Storageish | null, list: ServerEntry[]) {
  try { storage?.setItem(SERVERS_STORAGE_KEY, JSON.stringify(list)); } catch {}
}

const store = storageOrNull();

const [serverList, setServerList] = createSignal<ServerEntry[]>(readServers(store));

function initialActive(): string | null {
  const list = serverList();
  const saved = store?.getItem(ACTIVE_SERVER_STORAGE_KEY) || "";
  const chosen = list.find((entry) => entry.origin === saved) || list[0];
  return chosen?.origin ?? null;
}

const [active, setActive] = createSignal<string | null>(initialActive());

/** A browser's page came from a server, so that server belongs in the list whether or not anyone added it. */
function adoptServingOrigin() {
  if (isInstalledClient() || typeof location === "undefined") return;
  let here: string;
  try { here = normalizeServerOrigin(location.origin); } catch { return; }
  const list = serverList();
  if (!list.some((entry) => entry.origin === here)) {
    const next = [{ origin: here, name: defaultServerName(here), shared: sharedByDefault(here) }, ...list];
    setServerList(next);
    writeServers(store, next);
  }
  setActive(here);
}

adoptServingOrigin();

export const servers = serverList;
/*
 * Choosing a different path to the server already open tears nothing down; only the connections move. Choosing a
 * different server rebuilds the client.
 */
/*
 * The route last taken to each server, so a start begins there instead of at the address the server was added by.
 * Selection still proves it before trusting it, and moves on at once if it is gone.
 */
export const LAST_PATH_STORAGE_KEY = "conduit.servers.last-path";
function lastPaths(): Record<string, string> {
  try { return JSON.parse(store?.getItem(LAST_PATH_STORAGE_KEY) || "{}") || {}; } catch { return {}; }
}
function rememberPath(server: string | null, path: string | null) {
  if (!server) return;
  const all = lastPaths();
  if (path && path !== server) all[server] = path; else delete all[server];
  try { store?.setItem(LAST_PATH_STORAGE_KEY, JSON.stringify(all)); } catch {}
}
function restoredPath(server: string | null, list = serverList()): string | null {
  const entry = list.find((item) => item.origin === server);
  const saved = server ? lastPaths()[server] : undefined;
  return entry && saved && pathsOf(entry).some((path) => path.origin === saved) ? saved : null;
}
const [pathOverride, setPathOverride] = createSignal<string | null>(restoredPath(active()));
const [pathEpoch, bumpEpoch] = createSignal(0);
const pathMoves = new Set<() => void>();
const bumpPathEpoch = (step: (value: number) => number) => {
  bumpEpoch(step);
  for (const handler of [...pathMoves]) handler();
};
/** Outside any owner: a request still waiting on the old route gives up on it. */
export function whenPathMoves(handler: () => void) {
  pathMoves.add(handler);
  return () => { pathMoves.delete(handler); };
}
/** A route picked by hand pins it: automatic selection stands down until the route is set back to automatic. */
const [pinned, setPinned] = createSignal(false);

export const activeOrigin = active;
export const activePath = (): string | null => pathOverride() ?? active();
/** Long-lived connections watch this and reopen; nothing else should need it. */
export const pathGeneration = pathEpoch;

export const pathIsPinned = pinned;

/*
 * Every caller proves this address first, since a token goes wherever it points. Never expose this to page scripts
 * (such as a helper on `window`) outside `import.meta.env.DEV`, and never without the proof.
 */
export function setActivePath(origin: string, { manual = false } = {}) {
  const next = normalizeServerOrigin(origin);
  if (manual) setPinned(true);
  if (activePath() === next) return;
  setPathOverride(next);
  rememberPath(active(), next);
  bumpPathEpoch((value) => value + 1);
}

/**
 * Every long-lived connection builds its URL through `transport.js` when it opens, so closing it is the whole of the
 * move: its own reconnect lands on the new path.
 */
export function onPathChange(handler: () => void) {
  createEffect(on(pathGeneration, () => handler(), { defer: true }));
}

/**
 * `manual`: a person picking the server's own address pins it; the "Automatic" row or moving to another server frees
 * selection to choose again.
 */
export function clearActivePath({ manual = false } = {}) {
  setPinned(manual);
  if (pathOverride() === null) return;
  setPathOverride(null);
  rememberPath(active(), null);
  bumpPathEpoch((value) => value + 1);
}

export const activeServer = (): ServerEntry | null => serverList().find((entry) => entry.origin === active()) ?? null;

const shellVerifiesTls = installedClientKind === "desktop" || installedClientKind === "android";

/**
 * A local route is dialled as https once the server says it answers TLS and this shell can verify its leaf. There is
 * no falling back to http: something able to block the TLS connection could otherwise choose cleartext.
 */
export function dialOrigin(origin: string, entry: ServerEntry | null = activeServer()): string {
  if (!shellVerifiesTls || !entry?.tls || !origin.startsWith("http:") || scopeOf(origin) === "public") return origin;
  return `https:${origin.slice("http:".length)}`;
}

function persist(list: ServerEntry[], nextActive: string | null) {
  // A path belongs to the server it reaches, so changing server drops it
  // rather than carrying an address that now names somewhere else.
  if (nextActive !== active()) { setPathOverride(restoredPath(nextActive, list)); setPinned(false); }
  setServerList(list);
  writeServers(store, list);
  setActive(nextActive);
  try {
    if (nextActive) store?.setItem(ACTIVE_SERVER_STORAGE_KEY, nextActive);
    else store?.removeItem(ACTIVE_SERVER_STORAGE_KEY);
  } catch {}
}

export function addServer(value: string, name?: string): ServerEntry {
  const origin = normalizeServerOrigin(value);
  const label = name?.trim() || defaultServerName(origin);
  const existing = serverList().find((entry) => entry.origin === origin);
  const list = existing
    ? serverList().map((entry) => entry.origin === origin ? { ...entry, name: name?.trim() || entry.name } : entry)
    : [...serverList(), { origin, name: label, shared: sharedByDefault(origin) }];
  persist(list, active() ?? origin);
  return list.find((entry) => entry.origin === origin)!;
}

/**
 * Forgetting an address does not discard its token; the caller does that,
 * because only the caller knows whether the secure store answered.
 */
export function forgetServer(origin: string) {
  const list = serverList().filter((entry) => entry.origin !== origin);
  persist(list, active() === origin ? list[0]?.origin ?? null : active());
  // The shell keeps accepting a pinned certificate until it is sent a set
  // without it, so a forgotten server has to take its pin with it here.
  void publishTrustedIdentities(trustedIdentities());
}

/**
 * Union, never replacement: both lists are partial. A name already held here wins. The cost is that an address
 * forgotten here comes back while a server still lists it.
 */
export function mergeServerDirectory(entries: Array<{ origin?: unknown; name?: unknown }>): ServerEntry[] {
  const list = [...serverList()];
  const known = new Set(list.map((entry) => entry.origin));
  for (const item of Array.isArray(entries) ? entries : []) {
    let origin: string;
    try { origin = normalizeServerOrigin(item?.origin); } catch { continue; }
    if (known.has(origin)) continue;
    known.add(origin);
    const name = typeof item?.name === "string" && item.name.trim() ? item.name.trim() : defaultServerName(origin);
    // Recorded as anything but shared, it would drop out the next time this client wrote the directory back.
    list.push({ origin, name, shared: true });
  }
  if (list.length !== serverList().length) persist(list, active());
  return list;
}

export function setServerShared(origin: string, shared: boolean) {
  persist(serverList().map((entry) => entry.origin === origin ? { ...entry, shared } : entry), active());
}

/*
 * Two addresses are one server only once both have answered with the same id; a shared path is not that, since every
 * machine advertises 127.0.0.1. Advertised addresses are candidates for probing, never sent to because a payload said so.
 */
export function learnIdentity(
  origin: string,
  identity: { id?: unknown; name?: unknown; publicKey?: unknown; paths?: unknown; tls?: unknown },
) {
  const id = typeof identity?.id === "string" && /^[0-9a-f]{32}$/.test(identity.id) ? identity.id : "";
  if (!id) return;
  const publicKey = typeof identity?.publicKey === "string" && identity.publicKey.length <= 128 ? identity.publicKey : "";
  const list = serverList();
  const self = list.find((entry) => entry.origin === origin);
  if (!self) return;

  const serverName = typeof identity.name === "string" && identity.name.trim()
    ? identity.name.trim().slice(0, 63) : "";
  // The server owns its name; a client shows it rather than a label of its own.
  const name = serverName || self.name;
  // A path match is not an identity: the other row may be a different machine at the same address.
  const absorbed = list.filter((entry) => entry.origin !== origin && entry.id === id);
  // A loopback route already held is not evidence on its own: one recorded in
  // error would vouch for itself forever. It is re-proved below instead.
  const reachedHere = scopeOf(origin) === "loopback"
    || absorbed.some((entry) => scopeOf(entry.origin) === "loopback");
  const advertised = readPaths(identity?.paths, origin);
  const advertisedOrigins = new Set(advertised.map((path) => path.origin));
  const local = (path: ServerPath) => scopeOf(path.origin) !== "loopback" || reachedHere;
  // The route in use stays while the server still offers it, so a purge never
  // pulls the connection out from under the client.
  const inUse = (self.paths ?? []).filter((path) => path.origin === activePath() && advertisedOrigins.has(path.origin));

  // What the server says now, not everything it ever said, so an address it gives up leaves every client's list.
  const paths = readPaths([
    ...advertised.filter(local),
    ...inUse,
    ...absorbed.map((entry) => ({ origin: entry.origin, scope: scopeOf(entry.origin) })),
  ], origin);

  const next = list
    .filter((entry) => !absorbed.includes(entry))
    .map((entry) => entry.origin === origin
      ? { ...entry, name, ...(serverName ? { serverName } : {}), id, paths, ...(publicKey ? { publicKey } : {}), tls: identity.tls === true && !!publicKey }
      : entry);

  if (!reachedHere && publicKey && isInstalledClient()) {
    void discoverLoopback(origin, id, publicKey, advertised).catch(() => {});
  }
  if (sameList(next, list)) return;
  // The active server may have been one of the absorbed rows, in which case it
  // is now reached as a path of the survivor rather than as itself.
  const stillActive = next.some((entry) => entry.origin === active()) ? active() : origin;
  persist(next, stillActive);
}

/** A remote server's loopback is a candidate until it proves the same identity. */
async function discoverLoopback(origin: string, id: string, publicKey: string, paths: ServerPath[]) {
  const { proveServer } = await import("./server-proof.ts");
  const loopback = paths.filter((path) => scopeOf(path.origin) === "loopback");
  for (let start = 0; start < loopback.length; start += 4) {
    const batch = loopback.slice(start, start + 4);
    const proofs = batch.map((path) => proveServer(path.origin, id, publicKey));
    for (const proof of proofs) void proof.catch(() => {});
    for (const [index, request] of proofs.entries()) {
      const proof = await request;
      if (!proof.ok) continue;
      const path = batch[index]!;
      const list = serverList();
      const entry = list.find((entry) => entry.origin === origin && entry.id === id && entry.publicKey === publicKey);
      if (!entry) return;
      const next = list.map((item) => item === entry
        ? { ...item, paths: readPaths([...(item.paths ?? []), path], origin) } : item);
      if (!sameList(next, list)) persist(next, active());
    }
  }
}

function sameList(left: ServerEntry[], right: ServerEntry[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function setActiveServer(origin: string) {
  if (!serverList().some((entry) => entry.origin === origin)) return;
  persist(serverList(), origin);
}

/**
 * An installed client rebuilds itself around the new active address; a browser navigates, because another server is
 * another origin with its own session, service worker and storage.
 */
export function switchToServer(origin: string, installed: boolean) {
  if (!installed) {
    if (origin !== location.origin) location.assign(origin);
    return;
  }
  // The app is rebuilt around the other server: it opens on its sidebar, which names the server and lists its chats,
  // rather than on a chat address of the server just left.
  if (origin !== active()) rememberView({ path: "/", sidebar: true });
  setActiveServer(origin);
}

/**
 * One flat set, because the shell's certificate callback gets a certificate and no server. So one paired server's
 * certificate is accepted on another's address, which is no looser than pairing itself.
 */
export function trustedIdentities(list: ServerEntry[] = serverList()): TrustedIdentity[] {
  return list.flatMap((entry) => entry.id && entry.publicKey ? [{ id: entry.id, publicKey: entry.publicKey }] : []);
}
