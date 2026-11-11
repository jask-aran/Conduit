/*
 * The worker is held, not the reload: under `skipWaiting: false` a new build waits, because once it activates workbox
 * deletes precached files this page still loads on demand. This module says when; the library's `controlling`
 * listener does the one reload.
 */

import { createEffect, createSignal, onCleanup } from "solid-js";

const UPDATE_CHECK_TIMEOUT_MS = 15_000;

let registeredServiceWorker: ServiceWorkerRegistration | null = null;
let updateRequest: Promise<boolean> | null = null;
let resetRequest: Promise<void> | null = null;
let takeUpdate: (() => Promise<void>) | null = null;
let waiting = false;
let announce: (() => void) | null = null;
let holdsUpdate: (() => boolean) | null = null;
let preparing = false;
let preparation: Promise<void> | null = null;
let preparationTimer: ReturnType<typeof setTimeout> | null = null;
let releaseHoldLock: (() => void) | null = null;
let holdLockTask: Promise<void> | null = null;
let manualOverride = false;
const HOLD_LOCK = "conduit:pwa-unsaved-work";
// The default response drain is ten minutes. If it aborts after the notice,
// stop holding the installed worker once that drain could no longer succeed.
const PREPARATION_TIMEOUT_MS = 11 * 60_000;

export const pwaUpdateWaiting = () => waiting && !preparing;

// A dirty tab holds a shared lock. An update takes an exclusive lock before
// activating the origin-wide worker, so another tab cannot lose its draft.
function syncHoldLock() {
  if (!("locks" in navigator)) return;
  if (!holdsUpdate?.() || manualOverride) {
    releaseHoldLock?.();
    return;
  }
  if (holdLockTask) return;
  holdLockTask = navigator.locks.request(HOLD_LOCK, { mode: "shared" }, async () => {
    if (!holdsUpdate?.() || manualOverride) return;
    await new Promise<void>((resolve) => { releaseHoldLock = resolve; });
  }).then(() => {
    releaseHoldLock = null;
    holdLockTask = null;
    if (holdsUpdate?.() && !manualOverride) syncHoldLock();
  });
}

// Stays true through the reload once a build installs, so whatever would reconnect only to be torn down (a terminal
// back from a server restart) can wait it out.
const [updateImpending, setUpdateImpending] = createSignal(false);
export const pwaUpdateImpending = updateImpending;

// Taking an update ends this document, so the old page leaves the new one a note that it took one: per tab and per
// reload, so session storage.
const TOOK_UPDATE_KEY = "conduit:pwa-took-update";

const RELOAD_FALLBACK_MS = 4_000;

const LAST_BUILD_KEY = "conduit:last-build";

/** The entry script's hashed name is the build; the first run has nothing to compare and says no. */
export function arrivedByNewBuild(): boolean {
  const entry = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;
  if (!entry) return false;
  const build = new URL(entry).pathname;
  try {
    const last = localStorage.getItem(LAST_BUILD_KEY);
    localStorage.setItem(LAST_BUILD_KEY, build);
    return Boolean(last && last !== build);
  } catch {
    return false;
  }
}

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

/** `hold` is asked when a build arrives: false takes it now; true leaves it waiting for the caller's own moment. */
export function startPwaUpdates({ hold, onUpdateReady }: { hold: () => boolean; onUpdateReady: () => void }) {
  announce = onUpdateReady;
  holdsUpdate = hold;
  createEffect(() => { hold(); syncHoldLock(); });
  onCleanup(() => {
    holdsUpdate = null;
    releaseHoldLock?.();
  });
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
        if (preparing) setUpdateImpending(false);
        else if (!hold()) void applyPwaUpdate();
        else setUpdateImpending(false);
      },
    });
    takeUpdate = () => update();
  });
}

/** Take the waiting build now. The page reloads, so nothing after this runs. */
export function applyPwaUpdate(): Promise<boolean> {
  if (!waiting || !takeUpdate || preparing || (holdsUpdate?.() && !manualOverride)) return Promise.resolve(false);
  // Both the arrival and a hand-pressed check can ask for the same build; the
  // second gets the first's answer rather than a second SKIP_WAITING and a
  // second reload timer.
  taking ??= takeWaitingAcrossTabs(takeUpdate).then((taken) => {
    if (!taken) taking = null;
    return taken;
  }, (cause) => { taking = null; throw cause; });
  return taking;
}

let taking: Promise<boolean> | null = null;

async function takeWaitingAcrossTabs(update: () => Promise<void>): Promise<boolean> {
  // An automatic skipWaiting affects every tab on this origin. If this browser
  // cannot coordinate them, keep the worker waiting until a person asks for it.
  if (!("locks" in navigator)) {
    setUpdateImpending(false);
    return manualOverride ? takeWaiting(update) : false;
  }
  releaseHoldLock?.();
  await holdLockTask;
  const taken = await navigator.locks.request(HOLD_LOCK, { ifAvailable: true }, async (lock) => {
    if (!lock || (holdsUpdate?.() && !manualOverride)) return false;
    // Keep the exclusive lock until control changes. Releasing it as soon as
    // SKIP_WAITING is sent would let another tab start a draft before reload.
    const controlling = new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
      window.setTimeout(resolve, RELOAD_FALLBACK_MS);
    });
    const result = await takeWaiting(update);
    await controlling;
    return result;
  });
  if (!taken) setUpdateImpending(false);
  return taken;
}

async function takeWaiting(takeUpdate: () => Promise<void>): Promise<boolean> {
  try { sessionStorage.setItem(TOOK_UPDATE_KEY, "1"); } catch { /* private mode; the notice is not worth failing the update over */ }
  await takeUpdate();
  // A worker that activated on its own between being announced and accepted is no longer waiting, so SKIP_WAITING
  // reaches nobody and `controlling` never fires. The new build is installed by now, so a plain reload lands on it.
  window.setTimeout(() => window.location.reload(), RELOAD_FALLBACK_MS);
  return true;
}

export async function checkForPwaUpdate(background = false) {
  if (!("serviceWorker" in navigator)) return;
  if (!background) setUpdateImpending(true);
  let installing: ServiceWorker | null = null;
  try {
    const registration = registeredServiceWorker || await navigator.serviceWorker.getRegistration();
    await registration?.update();
    // `update()` settles once the new script is fetched; a changed one is
    // already installing by then, and `onNeedRefresh` takes it from here.
    installing = registration?.installing ?? null;
  } finally {
    if (!background && !taking) {
      if (!installing || waiting) setUpdateImpending(false);
      else installing.addEventListener("statechange", () => {
        if (installing?.state === "redundant") setUpdateImpending(false);
      });
    }
  }
}

/** Shared by every tab of this origin, so a restart counts the registration once; localStorage is per origin, as a registration is. */
export function browserRegistrationId(): string {
  const key = "conduit:sw-registration";
  try {
    const held = localStorage.getItem(key);
    if (held && /^[A-Za-z0-9_-]{8,64}$/.test(held)) return held;
    const made = Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(key, made);
    return made;
  } catch {
    return "";
  }
}

export type RestartReady = (ready: { attempt: string; target: string; registration: string }) => Promise<void>;

/**
 * After `update()` the waiting worker is the script just fetched, and with none waiting the active one is identical
 * to it, so the hash of what the server now serves at that URL is the build this registration holds.
 */
async function reportWhenInstalled(attempt: string, target: string, report: RestartReady) {
  await preparation;
  const registration = registeredServiceWorker || await navigator.serviceWorker.getRegistration();
  if (!registration) return;
  const installing = registration.installing;
  if (installing) await new Promise<void>((resolve) => {
    const settle = () => { if (installing.state !== "installing") resolve(); };
    installing.addEventListener("statechange", settle);
    settle();
  });
  const worker = registration.waiting || registration.active;
  if (!worker) return;
  const bytes = await (await fetch(worker.scriptURL, { cache: "no-store" })).arrayBuffer();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (target && hash !== target) return;
  await report({ attempt, target, registration: browserRegistrationId() });
}

/** Download the next client while this server still serves its static files. */
export function preparePwaRestart(attempt = "", target = "", report?: RestartReady) {
  if (!("serviceWorker" in navigator)) return;
  if (preparing) {
    if (attempt && report) void reportWhenInstalled(attempt, target, report).catch(() => {});
    return;
  }
  preparing = true;
  preparation = checkForPwaUpdate(true).catch(() => {});
  if (attempt && report) void reportWhenInstalled(attempt, target, report).catch(() => {});
  preparationTimer = window.setTimeout(() => {
    if (!preparing) return;
    preparing = false;
    if (waiting && !holdsUpdate?.()) void applyPwaUpdate();
  }, PREPARATION_TIMEOUT_MS);
}

export async function finishPwaRestart() {
  if (!preparing) return;
  preparing = false;
  if (preparationTimer !== null) window.clearTimeout(preparationTimer);
  preparationTimer = null;
  setUpdateImpending(true);
  try {
    await preparation;
    preparation = null;
    const registration = registeredServiceWorker || await navigator.serviceWorker.getRegistration();
    if (registration?.waiting) {
      waiting = true;
      if (holdsUpdate?.()) setUpdateImpending(false);
      else if (!await applyPwaUpdate()) setUpdateImpending(false);
    } else if (registration?.installing) {
      // onNeedRefresh takes it when installation finishes. A failed install
      // must not leave the terminal behind the update screen forever.
      const installing = registration.installing;
      const clearFailedInstall = () => {
        if (installing.state === "redundant") setUpdateImpending(false);
      };
      installing.addEventListener("statechange", clearFailedInstall);
      clearFailedInstall();
    } else setUpdateImpending(false);
  } catch {
    setUpdateImpending(false);
  }
}

/** Resolved by `onNeedRefresh`, not by watching the registration: the library attaches the reloading `controlling` listener in the same breath. */
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

async function performPwaUpdate(reloadPage: () => void) {
  if (!("serviceWorker" in navigator)) {
    try { sessionStorage.setItem(TOOK_UPDATE_KEY, "1"); } catch { /* as above */ }
    reloadPage();
    return true;
  }
  if (waiting) { preparing = false; return applyPwaUpdate(); }

  const registration = registeredServiceWorker || await navigator.serviceWorker.getRegistration();
  if (!registration) {
    try { sessionStorage.setItem(TOOK_UPDATE_KEY, "1"); } catch { /* as above */ }
    reloadPage();
    return true;
  }
  // Bounded: with the server gone this fetch can hang for minutes.
  await Promise.race([registration.update(), new Promise((_, reject) => setTimeout(() => reject(new Error("Could not reach the server to check for updates.")), UPDATE_CHECK_TIMEOUT_MS))]);
  // A new build precaches the whole client before it waits, which on a phone takes well past a few seconds; one
  // already waiting from before this page (never announced to it) is taken directly.
  if (!registration.installing && !registration.waiting) return false;
  if (!waiting && registration.waiting && !registration.installing) {
    return takeWaitingAcrossTabs(async () => registration.waiting?.postMessage({ type: "SKIP_WAITING" }));
  }
  if (!await untilWaiting(120_000)) return false;
  return applyPwaUpdate();
}

export function forcePwaUpdate(reloadPage: () => void = () => window.location.reload()) {
  if (!updateRequest) {
    manualOverride = true;
    releaseHoldLock?.();
    updateRequest = performPwaUpdate(reloadPage).finally(() => {
      updateRequest = null;
      manualOverride = false;
      syncHoldLock();
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
