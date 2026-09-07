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

const waitForActivation = (worker: ServiceWorker) => new Promise<void>((resolve, reject) => {
  if (worker.state === "activated") return resolve();
  const timeout = window.setTimeout(() => reject(new Error("The app update did not activate. Try again.")), 15_000);
  const advance = () => {
    if (worker.state === "installed") worker.postMessage({ type: "SKIP_WAITING" });
    if (worker.state === "activated") {
      window.clearTimeout(timeout);
      resolve();
    } else if (worker.state === "redundant") {
      window.clearTimeout(timeout);
      reject(new Error("The app update could not be installed."));
    }
  };
  worker.addEventListener("statechange", advance);
  advance();
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

  let update = registration.installing || registration.waiting;
  const captureUpdate = () => { update = registration.installing || registration.waiting; };
  registration.addEventListener("updatefound", captureUpdate);
  await registration.update();
  registration.removeEventListener("updatefound", captureUpdate);
  update ||= registration.installing || registration.waiting;
  if (!update) return false;
  await waitForActivation(update);
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
