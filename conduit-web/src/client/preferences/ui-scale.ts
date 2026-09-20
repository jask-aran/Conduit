import { installedClientKind } from "../platform/installed-client.ts";

export const UI_SCALE_STORAGE_KEY = "conduit:ui-scale";
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

/**
 * In a browser the scale is a CSS variable the whole stylesheet is written
 * against. In the desktop shell it is the webview's own zoom -- the same thing
 * Ctrl+= does in Chrome -- because that scales layout, rasterisation and hit
 * testing together, where the variable only reaches what the stylesheet
 * remembered to multiply. The two must not both apply, or the scale is
 * squared, so the desktop leaves the variable at 1.
 */
export function applyUiScale(scale: UiScale): UiScale {
  if (installedClientKind === "desktop") {
    document.documentElement.style.setProperty("--ui-scale", "1");
    void import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) => getCurrentWebview().setZoom(scale))
      .catch(() => { /* an older shell keeps the zoom it has */ });
    return scale;
  }
  document.documentElement.style.setProperty("--ui-scale", String(scale));
  return scale;
}

export function saveUiScale(scale: UiScale): UiScale {
  localStorage.setItem(UI_SCALE_STORAGE_KEY, String(scale));
  return applyUiScale(scale);
}
