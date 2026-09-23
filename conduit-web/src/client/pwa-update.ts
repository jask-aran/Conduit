/*
 * When a new build takes this page over.
 *
 * The page is one document holding live sockets, a transcript and whatever is
 * half-typed in the composer, and replacing it is not free. It used to happen
 * on its own and twice over: a `controllerchange` listener here reloaded, and
 * `vite-plugin-pwa` under `registerType: "autoUpdate"` attached its own
 * `activated` listener that reloaded as well. A tab that woke from the
 * background and checked for updates could find itself reloaded mid-sentence.
 *
 * So the worker is held rather than the reload. Under `skipWaiting: false` a
 * new build installs and then waits, which matters for more than politeness:
 * once it activates, workbox deletes the precached files the running page
 * still needs, and this client loads Settings, the workspace panel, the
 * terminal and the project dashboard on demand. An old page left running past
 * activation would 404 on the next thing it opened. Waiting keeps both builds
 * whole, so holding the update is genuinely free.
 *
 * One decision, one reload: this module says when, and the reload itself is
 * the library's `controlling` listener, the only one left.
 */

import { createSignal } from "solid-js";

let registeredServiceWorker: ServiceWorkerRegistration | null = null;
let updateRequest: Promise<boolean> | null = null;
let resetRequest: Promise<void> | null = null;
/** Sends SKIP_WAITING to the build that is waiting; the reload follows it. */
let takeUpdate: (() => Promise<void>) | null = null;
let waiting = false;
let announce: (() => void) | null = null;

/** Whether a new build is installed and waiting for a quiet moment. */
export const pwaUpdateWaiting = () => waiting;

/*
 * Whether a check is still deciding if this page is about to be replaced.
 *
 * True from the moment a check starts until it finds nothing, or a found
 * build fails to install. When a build does install it stays true through
 * the reload, so anything that would reconnect only to be torn down a second
 * later -- a terminal coming back from a server restart -- can wait it out
 * behind the screen it is already showing.
 */
const [updateImpending, setUpdateImpending] = createSignal(false);
export const pwaUpdateImpending = updateImpending;

/*
 * Taking an update ends this document, so nothing here can report that it
 * worked -- the page that would say so is the page being replaced. A tab that
 * blinks and comes back looking identical is indistinguishable from a button
 * that did nothing, which is exactly how it read: "why did it reload if there
 * was no update?" There was one. This is the note the old page leaves for the
 * new one, in session storage because it belongs to this tab and to this
 * reload alone.
 */
const TOOK_UPDATE_KEY = "conduit:pwa-took-update";

/** How long the worker gets to take over before the page reloads regardless. */
const RELOAD_FALLBACK_MS = 4_000;

/** Read once: the new build asks whether it arrived by an update, then forgets. */
export function claimPwaUpdateArrival(): boolean {
  try {
    if (sessionStorage.getItem(TOOK_UPDATE_KEY) !== "1") return false;
    sessionStorage.removeItem(TOOK_UPDATE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function rememberPwaRegistration(registration: ServiceWorkerRegistration | undefined) {
  registeredServiceWorker = registration || null;
}

/**
 * Register the worker and decide what happens when a new one is ready.
 *
 * `hold` is asked at the moment a build arrives: false means take it now, and
 * the reload is invisible because there was nothing to interrupt. True means
 * leave it waiting and tell the caller, which then chooses its own moment.
 */
export function startPwaUpdates({ hold, onUpdateReady }: { hold: () => boolean; onUpdateReady: () => void }) {
  announce = onUpdateReady;
  // Imported here rather than at the top of the file: `virtual:pwa-register`
  // exists only inside a Vite build, and everything else in this module is
  // ordinary code that its tests load directly under Node.
  void import("virtual:pwa-register").then(({ registerSW }) => {
    const update = registerSW({
      immediate: true,
      onRegisteredSW: (_url, registration) => rememberPwaRegistration(registration),
      onNeedRefresh: () => {
        waiting = true;
        // Announced first, so a hand-pressed check sees it landed; then taken
        // straight away if there was nothing on screen worth interrupting.
        announce?.();
        if (!hold()) void applyPwaUpdate();
        else setUpdateImpending(false);
      },
    });
    takeUpdate = () => update();
  });
}

/** Take the waiting build now. The page reloads, so nothing after this runs. */
export function applyPwaUpdate(): Promise<boolean> {
  if (!waiting || !takeUpdate) return Promise.resolve(false);
  // Both the arrival and a hand-pressed check can ask for the same build; the
  // second gets the first's answer rather than a second SKIP_WAITING and a
  // second reload timer.
  taking ??= takeWaiting(takeUpdate).catch((cause) => { taking = null; throw cause; });
  return taking;
}

let taking: Promise<boolean> | null = null;

async function takeWaiting(takeUpdate: () => Promise<void>): Promise<boolean> {
  try { sessionStorage.setItem(TOOK_UPDATE_KEY, "1"); } catch { /* private mode; the notice is not worth failing the update over */ }
  await takeUpdate();
  /*
   * The reload is the library's `controlling` listener, and it only fires if
   * the waiting worker actually takes over. It does not always: a worker that
   * activated on its own between being announced and being accepted is no
   * longer waiting, so SKIP_WAITING reaches nobody, nothing ever controls
   * anew, and the page sits on "Updating Conduit..." with no way out. A hard
   * reload fixed it by hand, which is the whole of this fallback -- by now the
   * new build is installed, so an ordinary reload lands on it.
   */
  window.setTimeout(() => window.location.reload(), RELOAD_FALLBACK_MS);
  return true;
}

export async function checkForPwaUpdate() {
  if (!("serviceWorker" in navigator)) return;
  setUpdateImpending(true);
  let installing: ServiceWorker | null = null;
  try {
    const registration = registeredServiceWorker || await navigator.serviceWorker.getRegistration();
    await registration?.update();
    // `update()` settles once the new script is fetched; a changed one is
    // already installing by then, and `onNeedRefresh` takes it from here.
    installing = registration?.installing ?? null;
  } finally {
    if (!installing || waiting) setUpdateImpending(false);
    else installing.addEventListener("statechange", () => {
      if (installing?.state === "redundant") setUpdateImpending(false);
    });
  }
}

/**
 * Wait for a new build to finish installing.
 *
 * Resolved by `onNeedRefresh` rather than by watching the registration, which
 * also guarantees the library has attached the `controlling` listener that
 * does the reload -- it adds that listener in the same breath.
 */
function untilWaiting(timeoutMs = 10_000) {
  return new Promise<boolean>((resolve) => {
    if (waiting) return resolve(true);
    // The app is not told during a hand-pressed check: it asked for this, so
    // an "update ready" notice a moment before the reload is noise.
    const previous = announce;
    const settle = (found: boolean) => {
      window.clearTimeout(timer);
      announce = previous;
      resolve(found);
    };
    const timer = window.setTimeout(() => settle(false), timeoutMs);
    announce = () => settle(true);
  });
}

/*
 * "Check for updates", pressed by hand.
 *
 * The same lever as the automatic path, minus the asking: somebody who pressed
 * this has said what they want. A false return means there was nothing to
 * install, which is the only answer that comes back -- a true one is followed
 * by the reload.
 */
async function performPwaUpdate(reloadPage: () => void) {
  if (!("serviceWorker" in navigator)) {
    try { sessionStorage.setItem(TOOK_UPDATE_KEY, "1"); } catch { /* as above */ }
    reloadPage();
    return true;
  }
  if (waiting) return applyPwaUpdate();

  const registration = registeredServiceWorker || await navigator.serviceWorker.getRegistration();
  if (!registration) {
    try { sessionStorage.setItem(TOOK_UPDATE_KEY, "1"); } catch { /* as above */ }
    reloadPage();
    return true;
  }
  await registration.update();
  // Nothing new was fetched: up to date. A new build precaches the whole
  // client before it waits, which over a phone connection takes well past a
  // few seconds -- so a build that is installing gets the time it needs, and
  // one already waiting from before this page (never announced to it) is
  // taken directly.
  if (!registration.installing && !registration.waiting) return false;
  if (!waiting && registration.waiting && !registration.installing) {
    try { sessionStorage.setItem(TOOK_UPDATE_KEY, "1"); } catch { /* as above */ }
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
    window.setTimeout(() => window.location.reload(), RELOAD_FALLBACK_MS);
    return true;
  }
  if (!await untilWaiting(120_000)) return false;
  return applyPwaUpdate();
}

export function forcePwaUpdate(reloadPage: () => void = () => window.location.reload()) {
  if (!updateRequest) {
    updateRequest = performPwaUpdate(reloadPage).finally(() => {
      updateRequest = null;
    });
  }
  return updateRequest;
}

async function performPwaCacheReset(reloadPage: () => void) {
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    registeredServiceWorker = null;
  }

  if ("caches" in globalThis) {
    const cacheNames = await globalThis.caches.keys();
    const precacheNames = cacheNames.filter((cacheName) => cacheName.includes("-precache-"));
    await Promise.all(precacheNames.map((cacheName) => globalThis.caches.delete(cacheName)));
  }

  reloadPage();
}

export function resetPwaAppCache(reloadPage: () => void = () => window.location.reload()) {
  if (!resetRequest) {
    resetRequest = performPwaCacheReset(reloadPage).finally(() => {
      resetRequest = null;
    });
  }
  return resetRequest;
}
