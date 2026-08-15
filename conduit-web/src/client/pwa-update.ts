let registeredServiceWorker: ServiceWorkerRegistration | null = null;
let updateRequest: Promise<void> | null = null;

export function rememberPwaRegistration(registration: ServiceWorkerRegistration | undefined) {
  registeredServiceWorker = registration || null;
}

function observeControllerChange(serviceWorker: ServiceWorkerContainer) {
  let timer: number | undefined;
  let finishObservation: (() => void) | undefined;
  let stopped = false;
  const changed = new Promise<void>((resolve) => {
    const finish = () => {
      if (stopped) return;
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      serviceWorker.removeEventListener("controllerchange", finish);
      resolve();
    };
    serviceWorker.addEventListener("controllerchange", finish, { once: true });
    timer = window.setTimeout(finish, 5_000);
    finishObservation = finish;
  });
  return {
    changed,
    stop: () => finishObservation?.(),
  };
}

async function performPwaUpdate(reloadPage: () => void) {
  if (!("serviceWorker" in navigator)) {
    reloadPage();
    return;
  }

  const serviceWorker = navigator.serviceWorker;
  const registration = registeredServiceWorker || await serviceWorker.getRegistration();
  if (!registration) {
    reloadPage();
    return;
  }

  const hadPendingWorker = Boolean(registration.installing || registration.waiting);
  const controllerChange = observeControllerChange(serviceWorker);
  try {
    await registration.update();
    const waitingWorker = registration.waiting;
    waitingWorker?.postMessage({ type: "SKIP_WAITING" });
    if (hadPendingWorker || registration.installing || waitingWorker) await controllerChange.changed;
  } finally {
    controllerChange.stop();
  }

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
