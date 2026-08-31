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

export function applyUiScale(scale: UiScale): UiScale {
  document.documentElement.style.setProperty("--ui-scale", String(scale));
  return scale;
}

export function saveUiScale(scale: UiScale): UiScale {
  localStorage.setItem(UI_SCALE_STORAGE_KEY, String(scale));
  return applyUiScale(scale);
}
