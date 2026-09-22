import { createEffect, createSignal, onCleanup } from "solid-js";
import { isInstalledClient } from "./installed-client.ts";
import { proveServer } from "./server-proof.ts";
import { activePath, activeServer, clearActivePath, pathIsPinned, pathsOf, setActivePath, type ServerPath } from "./servers.ts";

/*
 * Which route to take, decided rather than raced.
 *
 * The obvious design is to time every address and use the fastest. It is also
 * the wrong one: two routes a few milliseconds apart would trade places on
 * jitter alone, and every trade costs a reconnect. What actually decides this
 * is not speed but *reach* -- loopback means the server is on this machine, a
 * private address means it is on this network, and either is better than going
 * out to the internet and back in a way that no measurement is going to
 * overturn. So the order is fixed and the only question asked of a route is
 * whether it is there.
 *
 * That makes the behaviour predictable, which matters more here than being
 * optimal: a client that is on the LAN uses the LAN, and one that leaves uses
 * the tunnel, and neither decision depends on what the network was doing
 * during one sample.
 */

/**
 * The routes worth asking about while one is already working: the ones nearer
 * than it, and nothing else.
 *
 * A route further out is not an improvement, so asking every twenty seconds
 * would be traffic spent to learn nothing. An unknown current route is treated
 * as the worst case, since something is wrong if the route in use is not one
 * of the server's -- and everything is then worth trying.
 */
export function nearerThan(routes: ServerPath[], current: string | null): ServerPath[] {
  const index = routes.findIndex((path) => path.origin === current);
  if (index === 0) return [];
  return index < 0 ? routes : routes.slice(0, index);
}

/** Consecutive answers before a route is believed, either way. */
const ADOPT_AFTER = 2;
const ABANDON_AFTER = 2;

const IDLE_INTERVAL_MS = 20_000;
/** While the current route is failing, there is a reason to hurry. */
const SEARCHING_INTERVAL_MS = 5_000;
const REACH_TIMEOUT_MS = 3_000;

async function reachable(origin: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REACH_TIMEOUT_MS);
  try {
    const response = await fetch(new URL("/healthz", `${origin}/`).toString(), { cache: "no-store", signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface PathSelectorDeps {
  /**
   * Whether the client is in the middle of something a reconnect would show.
   *
   * A route change is cheap but not invisible: a terminal repaints and a
   * stream reopens. Doing that underneath a running generation to save a few
   * milliseconds is a bad trade, so an upgrade waits for a quiet moment. A
   * route that has *stopped working* does not wait -- staying on it is worse
   * than any interruption moving off it could cause.
   */
  busy: () => boolean;
}

export function startPathSelection(deps: PathSelectorDeps) {
  // A browser cannot change route in place: its cookie, storage and worker
  // belong to the origin that served it. Measuring routes it cannot take would
  // be traffic spent on a decision it is not allowed to make.
  if (!isInstalledClient()) return;

  const [searching, setSearching] = createSignal(false);
  const agree = new Map<string, number>();
  let running = false;

  const count = (origin: string, good: boolean) => {
    const previous = agree.get(origin) ?? 0;
    const next = good ? Math.max(0, previous) + 1 : Math.min(0, previous) - 1;
    agree.set(origin, next);
    return next;
  };

  /** Reachable, and able to prove it is the server this client paired with. */
  const usable = async (path: ServerPath, id: string, publicKey: string) => {
    if (!await reachable(path.origin)) return false;
    // Reach is not identity. Something else answering at this address would
    // pass the first check and fail this one, which is the whole reason a
    // route may be adopted without anybody looking at it.
    return (await proveServer(path.origin, id, publicKey)).ok;
  };

  const pass = async () => {
    if (running) return;
    const entry = activeServer();
    if (!entry?.id || !entry.publicKey || pathIsPinned()) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

    running = true;
    try {
      const routes = pathsOf(entry);
      const current = activePath();
      // Counts for routes that were forgotten or absorbed would otherwise wait
      // around to fast-track the same address if it ever came back.
      for (const origin of agree.keys()) {
        if (origin !== current && !routes.some((path) => path.origin === origin)) agree.delete(origin);
      }
      const currentIndex = routes.findIndex((path) => path.origin === current);

      const candidates = nearerThan(routes, current);

      for (const path of candidates) {
        if (await usable(path, entry.id, entry.publicKey)) {
          if (count(path.origin, true) < ADOPT_AFTER) break;
          // An upgrade is not urgent enough to interrupt anything.
          if (deps.busy()) break;
          agree.clear();
          setActivePath(path.origin);
          setSearching(false);
          return;
        }
        count(path.origin, false);
      }

      if (!current) return;
      const holding = await usable({ origin: current, scope: routes[currentIndex]?.scope ?? "public" }, entry.id, entry.publicKey);
      if (holding) {
        agree.set(current, Math.max(0, agree.get(current) ?? 0) + 1);
        setSearching(false);
        return;
      }
      if (count(current, false) > -ABANDON_AFTER) return;

      // The route in use has stopped answering. Anything that works is better
      // than staying, including one further out, and this does not wait for a
      // quiet moment -- there is nothing left to protect.
      setSearching(true);
      for (const path of routes) {
        if (path.origin === current) continue;
        if (!await usable(path, entry.id, entry.publicKey)) continue;
        agree.clear();
        if (path.origin === entry.origin) clearActivePath();
        else setActivePath(path.origin);
        setSearching(false);
        return;
      }
    } finally {
      running = false;
    }
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  createEffect(() => {
    clearInterval(timer);
    timer = setInterval(() => void pass(), searching() ? SEARCHING_INTERVAL_MS : IDLE_INTERVAL_MS);
  });

  const wake = () => { if (document.visibilityState === "visible") void pass(); };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
  }
  // Waking up and coming back onto a network are exactly when the answer is
  // most likely to have changed, and the moment a twenty-second timer is
  // least likely to catch.
  void pass();

  onCleanup(() => {
    clearInterval(timer);
    if (typeof document === "undefined") return;
    document.removeEventListener("visibilitychange", wake);
    window.removeEventListener("online", wake);
  });
}
