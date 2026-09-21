import { createEffect, createSignal, on } from "solid-js";
import { isInstalledClient } from "./installed-client.ts";

/**
 * The Conduit servers this client knows how to reach.
 *
 * A server is an address, a name and -- on an installed client -- a token of
 * its own. Nothing more: two addresses that happen to reach the same machine
 * are two servers here, because nothing the client can see says otherwise and
 * pretending to know better would mean trusting an unauthenticated endpoint to
 * say which box it is.
 *
 * A browser cannot use this to switch. Its page, its cookie, its service
 * worker and its storage all belong to the origin it was served from, so
 * choosing another server there means navigating to it -- a separate install
 * of the same app. The list is the same list; only the verb differs.
 */
export type PathScope = "loopback" | "private" | "public";

/** An address this server answers on, and what it costs to get there. */
export interface ServerPath {
  origin: string;
  scope: PathScope;
}

export interface ServerEntry {
  name: string;
  origin: string;
  /**
   * What the server says it is, once it has been asked over a connection it
   * authenticated. Absent until then, and absent forever for a server too old
   * to answer -- which is why nothing may depend on having it.
   */
  id?: string;
  /**
   * The public half of this server's key, handed over when this client signed
   * in. It is what makes another address checkable before a token is sent to
   * it -- see `server-proof.ts`.
   */
  publicKey?: string;
  /**
   * The other addresses this same server answers on. The entry's own `origin`
   * is always a path and is not repeated here.
   */
  paths?: ServerPath[];
  /**
   * Whether this address travels. The directory is kept by the servers, which
   * is the only channel two origins on one device share -- and it is a channel
   * every other device reads too, so what belongs on this machine and what
   * belongs everywhere has to be said rather than guessed.
   */
  shared: boolean;
}

export const SERVERS_STORAGE_KEY = "conduit.servers";
export const ACTIVE_SERVER_STORAGE_KEY = "conduit.servers.active";
/** What a client that could only hold one server wrote. Read, never written. */
export const LEGACY_ORIGIN_STORAGE_KEY = "conduit.native.server-origin";

// Where plain HTTP is allowed, and why it is not simply "never".
//
// Loopback never leaves the machine, so there is no network to protect it
// from -- the same line browsers draw for a secure context, and what lets a
// desktop client address the server beside it as 127.0.0.1 rather than
// needing a certificate for it.
//
// A private range is a weaker claim and worth saying out loud: the traffic
// does leave the machine, onto a network the person is standing on. Demanding
// HTTPS there does not protect that hop, it just means a server on the LAN
// cannot be reached at all without a certificate for an address that no
// public authority will issue one for. So these are allowed, and the address
// bar says http, which is the honest thing for it to say.
const LOOPBACK_HOST = /^(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[::1\])$/;
// 10/8, 172.16/12, 192.168/16 and the 169.254/16 a machine gives itself when
// nothing handed it an address.
const PRIVATE_HOST = /^(10(\.\d{1,3}){3}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|192\.168(\.\d{1,3}){2}|169\.254(\.\d{1,3}){2})$/;

const hostOf = (origin: string) => { try { return new URL(origin).hostname; } catch { return ""; } };

export const isLoopbackOrigin = (origin: string) => LOOPBACK_HOST.test(hostOf(origin));
/** On this machine, or on the network it is sitting on. */
export const isDirectOrigin = (origin: string) => {
  const host = hostOf(origin);
  return LOOPBACK_HOST.test(host) || PRIVATE_HOST.test(host);
};

/**
 * A local address stays put unless it is told otherwise. "127.0.0.1" names
 * whatever machine reads it, and "192.168.0.128" names whatever machine holds
 * that address on whatever network the reader happens to be on -- neither is
 * the same server everywhere, and a phone carrying one onto mobile data would
 * be pointed at nothing. Anything reachable by name is worth having on every
 * client that connects.
 */
export const sharedByDefault = (origin: string) => !isDirectOrigin(origin);

export function normalizeServerOrigin(value: unknown): string {
  const input = String(value || "").trim();
  const candidate = input.includes("://") ? input : `https://${input}`;
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

/**
 * What a server is called before anyone names it.
 *
 * The host including its port, because the port is often the only thing
 * telling two of them apart: a name taken from the hostname alone turns every
 * server on this machine into another row reading "127.0.0.1".
 */
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

/** What this address costs to reach, worked out from the address alone. */
export function scopeOf(origin: string): PathScope {
  const host = hostOf(origin);
  if (LOOPBACK_HOST.test(host)) return "loopback";
  return PRIVATE_HOST.test(host) ? "private" : "public";
}

/** Every address that reaches this server, its own included, nearest first. */
export function pathsOf(entry: ServerEntry): ServerPath[] {
  const all = [{ origin: entry.origin, scope: scopeOf(entry.origin) }, ...(entry.paths ?? [])];
  return all.sort((left, right) => SCOPES.indexOf(left.scope) - SCOPES.indexOf(right.scope));
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
    const shared = typeof item?.shared === "boolean" ? item.shared : sharedByDefault(origin);
    const id = typeof item?.id === "string" && /^[0-9a-f]{32}$/.test(item.id) ? item.id : undefined;
    const publicKey = typeof item?.publicKey === "string" && item.publicKey.length <= 128 ? item.publicKey : undefined;
    const paths = readPaths(item?.paths, origin);
    list.push({ origin, name, shared, ...(id ? { id } : {}), ...(publicKey ? { publicKey } : {}), ...(paths.length ? { paths } : {}) });
  }
  return list;
}

export function writeServers(storage: Storageish | null, list: ServerEntry[]) {
  try { storage?.setItem(SERVERS_STORAGE_KEY, JSON.stringify(list)); } catch { /* nothing to do about a full or blocked store */ }
}

/**
 * Carry the one server a previous version could hold into the list.
 *
 * The old key is left where it is: the token that belongs to that server is
 * still stored under the old name too, and the only way to know which server
 * to hand it to is to remember which one was configured.
 */
export function migrateLegacyServer(storage: Storageish | null) {
  if (!storage || storage.getItem(SERVERS_STORAGE_KEY)) return;
  const legacy = storage.getItem(LEGACY_ORIGIN_STORAGE_KEY);
  if (!legacy) return;
  let origin: string;
  try { origin = normalizeServerOrigin(legacy); } catch { return; }
  writeServers(storage, [{ origin, name: defaultServerName(origin), shared: sharedByDefault(origin) }]);
  try { storage.setItem(ACTIVE_SERVER_STORAGE_KEY, origin); } catch {}
}

const store = storageOrNull();
migrateLegacyServer(store);

const [serverList, setServerList] = createSignal<ServerEntry[]>(readServers(store));

function initialActive(): string | null {
  const list = serverList();
  const saved = store?.getItem(ACTIVE_SERVER_STORAGE_KEY) || "";
  const chosen = list.find((entry) => entry.origin === saved) || list[0];
  return chosen?.origin ?? null;
}

const [active, setActive] = createSignal<string | null>(initialActive());

/**
 * A browser is already on a server -- the page came from it -- so it belongs in
 * the list whether or not anyone added it. Without this the switcher would
 * offer somewhere to go and no name for where you are.
 */
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
 * The path in use, separately from the server in use.
 *
 * A server is one thing; the route taken to it is another, and they change for
 * different reasons and cost different amounts. Choosing a different *server*
 * means everything on screen belonged to somewhere else, so the client is
 * rebuilt around the new one. Choosing a different *path* to the server
 * already open means nothing on screen is wrong -- the same chats, the same
 * processes, the same running generation -- so nothing may be torn down. Only
 * the connections move.
 *
 * Until a server can say which addresses are it, a server has exactly one
 * path: its own origin. `activePath` therefore reads as `activeOrigin` today
 * and the machinery below is exercised by nothing but its test. That is
 * deliberate -- the reconnect is the part that can fail ugly, and it is worth
 * having working before anything starts choosing paths automatically.
 */
const [pathOverride, setPathOverride] = createSignal<string | null>(null);
const [pathEpoch, bumpPathEpoch] = createSignal(0);
/**
 * Whether a person chose this route.
 *
 * A route picked by hand is a decision, and something measuring latency in the
 * background has no business overruling it. Automatic selection stands down
 * until the route is set back to automatic.
 */
const [pinned, setPinned] = createSignal(false);

export const activeOrigin = active;
/** Where requests actually go: the chosen path, or the server's own address. */
export const activePath = (): string | null => pathOverride() ?? active();
/**
 * Changes whenever the path does. Long-lived connections watch this and
 * reopen; nothing else should need it.
 */
export const pathGeneration = pathEpoch;

/**
 * Take a different route to the server already in use. A no-op if it is the
 * route already in use, so a probe that keeps choosing the same winner costs
 * nothing.
 */
export const pathIsPinned = pinned;

export function setActivePath(origin: string, { manual = false } = {}) {
  const next = normalizeServerOrigin(origin);
  if (manual) setPinned(true);
  if (activePath() === next) return;
  setPathOverride(next);
  bumpPathEpoch((value) => value + 1);
}

/**
 * Run something whenever the path changes, and not when it is first read.
 *
 * Every long-lived connection builds its URL through `transport.js` at the
 * moment it opens, so a connection that closes and reopens lands on the new
 * path without being told what it is. That makes this the whole of the move:
 * close, and let the reconnect each of them already has do the rest.
 *
 * Takes the caller's owner, so a connection that is disposed stops listening.
 */
export function onPathChange(handler: () => void) {
  createEffect(on(pathGeneration, () => handler(), { defer: true }));
}

/*
 * A way to move the path by hand, until a server can say which addresses are
 * it and something starts choosing between them.
 *
 * The reconnect is the part of this that can fail ugly, and it cannot be
 * proved by a unit test: what has to hold is that a live terminal repaints
 * instead of erroring and a running generation keeps streaming, in a real
 * client, over a real network. So the move is reachable from the console
 * before there is a UI for it:
 *
 *   conduitPath.set("http://192.168.0.128:4310")   // same server, new route
 *   conduitPath.clear()                            // back to its own address
 *
 * Removed once something chooses paths on its own.
 */
if (typeof window !== "undefined") {
  (window as unknown as { conduitPath: unknown }).conduitPath = {
    get current() { return activePath(); },
    get server() { return active(); },
    set: (origin: string) => { setActivePath(origin); return activePath(); },
    clear: () => { clearActivePath(); return activePath(); },
  };
}

/**
 * Back to addressing the server by its own address.
 *
 * `manual` says who decided. A person picking that address is a choice like
 * any other and pins it; the client being handed the decision back -- the
 * "Automatic" row, or moving to another server -- is the opposite, and frees
 * selection to choose again.
 */
export function clearActivePath({ manual = false } = {}) {
  setPinned(manual);
  if (pathOverride() === null) return;
  setPathOverride(null);
  bumpPathEpoch((value) => value + 1);
}

export const activeServer = (): ServerEntry | null => serverList().find((entry) => entry.origin === active()) ?? null;

function persist(list: ServerEntry[], nextActive: string | null) {
  // A path belongs to the server it reaches, so changing server drops it
  // rather than carrying an address that now names somewhere else.
  if (nextActive !== active()) { setPathOverride(null); setPinned(false); }
  setServerList(list);
  writeServers(store, list);
  setActive(nextActive);
  try {
    if (nextActive) store?.setItem(ACTIVE_SERVER_STORAGE_KEY, nextActive);
    else store?.removeItem(ACTIVE_SERVER_STORAGE_KEY);
  } catch {}
}

/** Adds, or renames in place: the address is the identity, the name is a label. */
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

export function renameServer(origin: string, name: string) {
  const label = name.trim() || defaultServerName(origin);
  persist(serverList().map((entry) => entry.origin === origin ? { ...entry, name: label } : entry), active());
}

/**
 * Forgetting an address does not discard its token; the caller does that,
 * because only the caller knows whether the secure store answered.
 */
export function forgetServer(origin: string) {
  const list = serverList().filter((entry) => entry.origin !== origin);
  persist(list, active() === origin ? list[0]?.origin ?? null : active());
}

/**
 * Fold a server's directory into this client's list, and report back anything
 * it did not have.
 *
 * Union, never replacement. The two lists are both partial -- this client has
 * been somewhere the server has not been told about, and the server has been
 * told by clients this one has never met -- so the only merge that loses
 * nothing is to keep both. A name already held here wins, because it is the
 * one the person using this client chose.
 *
 * Forgetting is the cost of that: an address removed here comes back the next
 * time a server that still lists it is opened. Names are cheap to correct and
 * a wrong address is inert, which is a better trade than a list that silently
 * disagrees with itself across devices.
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
    // It arrived through the directory, so it is already an address that
    // travels; recording it as anything else would quietly drop it the next
    // time this client wrote the directory back.
    list.push({ origin, name, shared: true });
  }
  if (list.length !== serverList().length) persist(list, active());
  return list;
}

export function setServerShared(origin: string, shared: boolean) {
  persist(serverList().map((entry) => entry.origin === origin ? { ...entry, shared } : entry), active());
}

/*
 * Take what a server said about itself, and fold the list around it.
 *
 * Two addresses the user added separately turn out to be one machine. The
 * entry that answered keeps its name and its place; the other is removed and
 * survives as a path underneath it, so a server registered twice stops looking
 * like two servers without anyone having to notice and tidy up.
 *
 * The addresses the server offers are recorded, not trusted. Every one of them
 * is a claim made by something that could be wrong about its own network -- a
 * LAN address is only true on that LAN -- so they are candidates for probing,
 * and never somewhere requests are sent because a payload said so.
 */
export function learnIdentity(origin: string, identity: { id?: unknown; publicKey?: unknown; paths?: unknown }) {
  const id = typeof identity?.id === "string" && /^[0-9a-f]{32}$/.test(identity.id) ? identity.id : "";
  if (!id) return;
  const publicKey = typeof identity?.publicKey === "string" && identity.publicKey.length <= 128 ? identity.publicKey : "";
  const list = serverList();
  const self = list.find((entry) => entry.origin === origin);
  if (!self) return;

  const offered = readPaths(identity?.paths, origin);
  // An address the user already added, which this server now says is itself.
  const absorbed = list.filter((entry) => entry.origin !== origin
    && (entry.id === id || offered.some((path) => path.origin === entry.origin)));

  const paths = readPaths([
    ...offered,
    ...(self.paths ?? []),
    ...absorbed.map((entry) => ({ origin: entry.origin, scope: scopeOf(entry.origin) })),
  ], origin);

  const next = list
    .filter((entry) => !absorbed.includes(entry))
    .map((entry) => entry.origin === origin
      ? { ...entry, id, paths, ...(publicKey ? { publicKey } : {}) }
      : entry);

  if (sameList(next, list)) return;
  // The active server may have been one of the absorbed rows, in which case it
  // is now reached as a path of the survivor rather than as itself.
  const stillActive = next.some((entry) => entry.origin === active()) ? active() : origin;
  persist(next, stillActive);
}

function sameList(left: ServerEntry[], right: ServerEntry[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function setActiveServer(origin: string) {
  if (!serverList().some((entry) => entry.origin === origin)) return;
  persist(serverList(), origin);
}

/**
 * Go to a server.
 *
 * An installed client only records the choice: the client watches the active
 * address and rebuilds itself around the new one, which disposes everything
 * the old server owned without re-parsing a bundle that says nothing about
 * either of them.
 *
 * A browser navigates instead, because the other server is a different origin
 * and therefore a different installation of this app, with its own session,
 * service worker and storage.
 */
export function switchToServer(origin: string, installed: boolean) {
  if (!installed) {
    if (origin !== location.origin) location.assign(origin);
    return;
  }
  setActiveServer(origin);
}
