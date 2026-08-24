export type ComposerSurfaceMode = "static" | "frosted-live";

export const COMPOSER_SURFACE_STORAGE_KEY = "conduit:composer-surface";
export const COMPOSER_SURFACE_CHANGE_EVENT = "conduit:composer-surface-change";

export const COMPOSER_SURFACE_OPTIONS: readonly {
  value: ComposerSurfaceMode;
  label: string;
  description: string;
}[] = [
  {
    value: "static",
    label: "Static",
    description: "Use the original glassmorphism composer over an opaque local backing surface, without sampling transcript pixels.",
  },
  {
    value: "frosted-live",
    label: "Frosted Live",
    description: "Keep native backdrop blur active over the live transcript during panel motion.",
  },
];

const isComposerSurfaceMode = (value: string | null): value is ComposerSurfaceMode => value === "static" || value === "frosted-live";

export function selectedComposerSurface(storage: Pick<Storage, "getItem"> = localStorage): ComposerSurfaceMode {
  const selected = storage.getItem(COMPOSER_SURFACE_STORAGE_KEY);
  return isComposerSurfaceMode(selected) ? selected : "frosted-live";
}

export function saveComposerSurface(
  surface: ComposerSurfaceMode,
  storage: Pick<Storage, "setItem"> = localStorage,
): ComposerSurfaceMode {
  storage.setItem(COMPOSER_SURFACE_STORAGE_KEY, surface);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<ComposerSurfaceMode>(COMPOSER_SURFACE_CHANGE_EVENT, { detail: surface }));
  return surface;
}
