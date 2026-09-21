let registeredServiceWorker: ServiceWorkerRegistration | null = null;
let updateRequest: Promise<boolean> | null = null;
let resetRequest: Promise<void> | null = null;

export function rememberPwaRegistration(registration: ServiceWorkerRegistration | undefined) {
  registeredServiceWorker = registration || null;
}

export async function checkForPwaUpdate() {
  if (!("serviceWorker" in navigator)) return;
  const registration = registeredServiceWorker || await navigator.serviceWorker.getRegistration();
  await registration?.update();
}

/**
 * Wait for the new worker to take this page over.
 *
 * There is nothing to ask it to do. The generated worker skips waiting and
 * claims its clients by itself -- it registers no message handler at all, so
 * the older habit of posting SKIP_WAITING to it was talking to nobody. The
 * handover is the only event worth waiting for, and it is not one that can
 * fail: if it does not arrive, the new worker is active regardless and a
 * reload is what shows it. So this times out into success rather than into an
 * error about an update that did in fact install.
 */
const waitForHandover = (timeoutMs = 10_000) => new Promise<void>((resolve) => {
  const settle = () => {
    window.clearTimeout(timer);
    navigator.serviceWorker.removeEventListener("controllerchange", settle);
    resolve();
  };
  const timer = window.setTimeout(settle, timeoutMs);
  navigator.serviceWorker.addEventListener("controllerchange", settle);
});

async function performPwaUpdate(reloadPage: () => void) {
  if (!("serviceWorker" in navigator)) {
    reloadPage();
    return true;
  }

  const registration = registeredServiceWorker || await navigator.serviceWorker.getRegistration();
  if (!registration) {
    reloadPage();
    return true;
  }

  // `updatefound` is the only reliable account of whether there was anything to
  // install: a worker that skips waiting can be installed, activated and in
  // charge before `update()` even resolves, leaving nothing behind to inspect.
  let found = Boolean(registration.installing || registration.waiting);
  const noteUpdate = () => { found = true; };
  registration.addEventListener("updatefound", noteUpdate);
  try { await registration.update(); }
  finally { registration.removeEventListener("updatefound", noteUpdate); }
  if (!found) return false;
  await waitForHandover();
  reloadPage();
  return true;
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
