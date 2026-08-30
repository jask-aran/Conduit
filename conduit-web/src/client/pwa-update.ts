let registeredServiceWorker: ServiceWorkerRegistration | null = null;
let updateRequest: Promise<void> | null = null;
let resetRequest: Promise<void> | null = null;

export function rememberPwaRegistration(registration: ServiceWorkerRegistration | undefined) {
  registeredServiceWorker = registration || null;
}

export async function checkForPwaUpdate() {
  if (!("serviceWorker" in navigator)) return;
  const registration = registeredServiceWorker || await navigator.serviceWorker.getRegistration();
  await registration?.update();
}

async function performPwaUpdate(reloadPage: () => void) {
  if (!("serviceWorker" in navigator)) {
    reloadPage();
    return;
  }

  const registration = registeredServiceWorker || await navigator.serviceWorker.getRegistration();
  if (!registration) {
    reloadPage();
    return;
  }

  await registration.update();
  reloadPage();
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
