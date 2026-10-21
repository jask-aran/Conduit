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

/** The desktop shell's Scale was once the webview's zoom: the first run that scales in the stylesheet takes it as the
 *  Interface size, once, and sets the webview back to 1, so the two never multiply. */
const IN_APP_STORAGE_KEY = "conduit:ui-scale-in-app";
function adoptDesktopZoom() {
  if (installedClientKind !== "desktop" || localStorage.getItem(IN_APP_STORAGE_KEY)) return;
  const zoom = savedDesktopZoom() ?? selectedUiScale();
  const nearest = UI_SCALE_OPTIONS.reduce((best, option) => Math.abs(option - zoom) < Math.abs(best - zoom) ? option : best);
  localStorage.setItem(UI_SCALE_STORAGE_KEY, String(nearest));
  localStorage.setItem(DESKTOP_ZOOM_STORAGE_KEY, "1");
  localStorage.setItem(IN_APP_STORAGE_KEY, "1");
}

/**
 * The Interface size is --ui-scale on <html>, which the stylesheet multiplies into every region's unit (foundations.css,
 * Scale), so each region can keep a size of its own against the others; the browser's or the webview's zoom stays the
 * user's own, on top (in the desktop shell, Ctrl+= is still remembered and restored).
 */
export function applyUiScale(scale: UiScale, restoreZoom = false): UiScale {
  if (restoreZoom) adoptDesktopZoom();
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
