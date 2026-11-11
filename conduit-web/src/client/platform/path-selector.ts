import { createEffect, createSignal, onCleanup } from "solid-js";
import { isInstalledClient } from "./installed-client.ts";
import { proveServer } from "./server-proof.ts";
import { activePath, activeServer, clearActivePath, dialOrigin, pathIsPinned, pathsOf, setActivePath, type ServerEntry, type ServerPath } from "./servers.ts";

/*
 * Routes are ranked by reach (loopback, then private, then public), never by measured speed: routes a few
 * milliseconds apart would trade places on jitter, and every trade costs a reconnect.
 */

/** An unknown current route is treated as the worst case, so every route is worth trying. */
export function nearerThan(routes: ServerPath[], current: string | null): ServerPath[] {
  const index = routes.findIndex((path) => path.origin === current);
  if (index === 0) return [];
  return index < 0 ? routes : routes.slice(0, index);
}

const ADOPT_AFTER = 2;
const ABANDON_AFTER = 2;

const IDLE_INTERVAL_MS = 20_000;
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
  /** An upgrade waits while this is true; leaving a route that stopped working does not. */
  busy: () => boolean;
}

export function startPathSelection(deps: PathSelectorDeps) {
  // A browser cannot change route in place: its cookie, storage and worker belong to the origin that served it.
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

  const usable = async (path: ServerPath, entry: ServerEntry) => {
    // Probed exactly as it would be dialled, https included.
    const origin = dialOrigin(path.origin, entry);
    if (!await reachable(origin)) return false;
    // Reach is not identity: something else may answer at this address.
    return (await proveServer(origin, entry.id!, entry.publicKey!)).ok;
  };

  const probeAll = (paths: ServerPath[], entry: ServerEntry) =>
    Promise.all(paths.map((path) => usable(path, entry)));

  const KEEP_MS = 1500;
  const KEEP_BUSY_MS = 8000;
  /**
   * Starting, waking or changing network: the route in use may be gone, so every route is asked at once and the
   * first to prove itself is taken, unless the one in use answers within KEEP_MS. A nearer route that answers later
   * is taken by the passes after.
   */
  const rush = async () => {
    if (running) return;
    const entry = activeServer();
    if (!entry?.id || !entry.publicKey || pathIsPinned()) return;
    running = true;
    try {
      const routes = pathsOf(entry);
      const current = activePath();
      const asked = routes.map((path) => usable(path, entry).then((ok) => ok ? path : Promise.reject()));
      const first = await Promise.any(asked).catch(() => null);
      if (!first) { setSearching(true); return; }
      // A route in use that still answers promptly is kept: taking whichever answered first flaps between routes on
      // the passes after, cutting off what was in flight each time.
      if (first.origin !== current && current) {
        const index = routes.findIndex((path) => path.origin === current);
        const prompt = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), deps.busy() ? KEEP_BUSY_MS : KEEP_MS));
        if (index >= 0 && await Promise.race([asked[index]!.then(() => true, () => false), prompt])) { setSearching(false); return; }
      }
      agree.clear();
      setSearching(false);
      if (first.origin === current) return;
      if (first.origin === entry.origin) clearActivePath();
      else setActivePath(first.origin);
    } finally {
      running = false;
    }
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
      // Stale counts would fast-track a forgotten address if it came back.
      for (const origin of agree.keys()) {
        if (origin !== current && !routes.some((path) => path.origin === origin)) agree.delete(origin);
      }
      const currentIndex = routes.findIndex((path) => path.origin === current);

      const candidates = nearerThan(routes, current);
      const currentPath = current ? { origin: current, scope: routes[currentIndex]?.scope ?? "public" as const } : null;
      const [answers, holding] = await Promise.all([
        probeAll(candidates, entry),
        currentPath ? usable(currentPath, entry) : Promise.resolve(false),
      ]);

      for (const [index, path] of candidates.entries()) {
        if (answers[index]) {
          if (count(path.origin, true) < ADOPT_AFTER) break;
          if (deps.busy()) break;
          agree.clear();
          setActivePath(path.origin);
          setSearching(false);
          return;
        }
        count(path.origin, false);
      }

      if (!current) return;
      if (holding) {
        agree.set(current, Math.max(0, agree.get(current) ?? 0) + 1);
        setSearching(false);
        return;
      }
      if (count(current, false) > -ABANDON_AFTER) return;

      // Any working route beats a dead one, further out included, without waiting for a quiet moment.
      setSearching(true);
      const others = routes.filter((path) => path.origin !== current);
      const reachableOthers = await probeAll(others, entry);
      for (const [index, path] of others.entries()) {
        if (!reachableOthers[index]) continue;
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

  const wake = () => { if (document.visibilityState === "visible") void rush(); };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
  }
  void rush();

  onCleanup(() => {
    clearInterval(timer);
    if (typeof document === "undefined") return;
    document.removeEventListener("visibilitychange", wake);
    window.removeEventListener("online", wake);
  });
}
