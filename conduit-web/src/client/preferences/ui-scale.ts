import { installedClientKind } from "../platform/installed-client.ts";

export const UI_SCALE_STORAGE_KEY = "conduit:ui-scale";
const DESKTOP_ZOOM_STORAGE_KEY = "conduit:desktop-zoom";
export const UI_SCALE_OPTIONS = [0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5] as const;
export type UiScale = typeof UI_SCALE_OPTIONS[number];

function isUiScale(value: number): value is UiScale {
  return UI_SCALE_OPTIONS.some((option) => option === value);
}

export function selectedUiScale(): UiScale {
  if (typeof localStorage === "undefined") return 1;
  return parseUiScale(localStorage.getItem(UI_SCALE_STORAGE_KEY));
}

export function parseUiScale(value: string | null): UiScale {
  const parsed = Number(value);
  return isUiScale(parsed) ? parsed : 1;
}

function savedDesktopZoom(): number | null {
  const zoom = Number(localStorage.getItem(DESKTOP_ZOOM_STORAGE_KEY));
  return Number.isFinite(zoom) && zoom >= 0.25 && zoom <= 5 ? zoom : null;
}

let desktopZoomTracking: Promise<void> | undefined;
function trackDesktopZoom(): Promise<void> {
  return desktopZoomTracking ??= import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
    const nativeWindow = getCurrentWindow();
    let monitorScale = await nativeWindow.scaleFactor();
    const remember = () => {
      // WebView2's pixel ratio includes both monitor DPI and browser zoom.
      const zoom = Math.round(window.devicePixelRatio / monitorScale * 1000) / 1000;
      if (zoom >= 0.25 && zoom <= 5 && localStorage.getItem(DESKTOP_ZOOM_STORAGE_KEY) !== String(zoom)) {
        localStorage.setItem(DESKTOP_ZOOM_STORAGE_KEY, String(zoom));
      }
    };
    window.addEventListener("resize", remember);
    window.addEventListener("pagehide", remember);
    await nativeWindow.onScaleChanged(({ payload }) => { monitorScale = payload.scaleFactor; remember(); });
    remember();
  });
}

const nearest = (value: number): UiScale => UI_SCALE_OPTIONS.reduce((best, option) => Math.abs(option - value) < Math.abs(best - value) ? option : best);

/**
 * --ui-scale is multiplied into every region's unit, so each region can keep a size of its own against the others;
 * the browser's or the webview's zoom stays the user's own, on top.
 */
export function applyUiScale(scale: UiScale, restoreZoom = false): UiScale {
  const applied = restoreZoom ? selectedUiScale() : scale;
  document.documentElement.style.setProperty("--ui-scale", String(applied));
  dispatchEvent(new Event("conduit:ui-scale"));
  if (installedClientKind === "desktop" && restoreZoom) {
    void import("@tauri-apps/api/webview")
      .then(async ({ getCurrentWebview }) => {
        await getCurrentWebview().setZoom(savedDesktopZoom() ?? 1);
        await trackDesktopZoom();
      })
      .catch(() => { /* an older shell keeps the zoom it has */ });
  }
  return applied;
}

export function saveUiScale(scale: UiScale): UiScale {
  localStorage.setItem(UI_SCALE_STORAGE_KEY, String(scale));
  return applyUiScale(scale);
}

export function stepUiScale(step: 1 | -1 | 0): UiScale {
  const current = selectedUiScale();
  const at = UI_SCALE_OPTIONS.indexOf(current);
  const next = step === 0 ? 1 : UI_SCALE_OPTIONS[Math.max(0, Math.min(UI_SCALE_OPTIONS.length - 1, at + step))]!;
  return next === current ? current : saveUiScale(next);
}

/** How far a wheel (or a trackpad's pinch, which arrives as Ctrl+wheel) turns for one step of the Interface size. */
const WHEEL_STEP = 100;

/**
 * Ctrl+wheel (and a trackpad pinch) steps the Interface size instead of the webview's zoom, which scales the page as a
 * picture and leaves the setting saying otherwise.
 */
export function followZoomGestures() {
  if (installedClientKind === "desktop") {
    const zoom = savedDesktopZoom();
    if (zoom && Math.abs(zoom - 1) > 0.01) {
      saveUiScale(nearest(selectedUiScale() * zoom));
      localStorage.setItem(DESKTOP_ZOOM_STORAGE_KEY, "1");
      void import("@tauri-apps/api/webview").then(({ getCurrentWebview }) => getCurrentWebview().setZoom(1)).catch(() => {});
    }
  }
  let turned = 0;
  let last = 0;
  window.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    // A pause starts a new gesture: what was left of the last one does not carry into it.
    if (event.timeStamp - last > 400) turned = 0;
    last = event.timeStamp;
    turned += event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY;
    if (Math.abs(turned) < WHEEL_STEP) return;
    stepUiScale(turned < 0 ? 1 : -1);
    turned = 0;
  }, { passive: false, capture: true });
}
