import { createRoot } from "solid-js";
import { api } from "../api/client.ts";
import { createAutosave } from "../settings/autosave.ts";
import type { UI_PREFERENCES } from "../../preferences-api.js";

export const UI_PREFERENCE_CHANGE_EVENT = "conduit:ui-preference-change";

/* The UI preferences as the declaration lists them (preferences-api.js), plus the sidebar's pins, saved beside them. */
type Declared = typeof UI_PREFERENCES;
type ValueOf<P> = P extends { type: "boolean" } ? boolean
  : P extends { type: "integer" } ? number
  : P extends { type: "strings" } ? string[]
  : P extends { type: "choice"; values: readonly (infer V)[] } ? V
  : Record<string, unknown>;
export type UiPreferences = { [K in keyof Declared]: ValueOf<Declared[K]> | null } & { sidebarPins: string[] | null };
export type UiPreferenceChoice<K extends keyof Declared> = NonNullable<UiPreferences[K]>;

export type UiPreferenceKey = keyof UiPreferences;

export function publishUiPreference<K extends UiPreferenceKey>(key: K, value: UiPreferences[K]) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(UI_PREFERENCE_CHANGE_EVENT, { detail: { key, value } }));
  }
  return value;
}

/*
 * Every UI preference reaches the server through one autosave: edits made
 * while a save is out are gathered into the next one, and a failure keeps
 * them all for Retry. Settings shows its state in the section header.
 */
let unsaved: Partial<UiPreferences> = {};
export const uiPreferenceSaves = createRoot(() => createAutosave<Partial<UiPreferences>>({
  save: (patch) => api<UiPreferences>("/v0/preferences", { method: "PATCH", body: JSON.stringify(patch) }).then(() => patch),
  onSaved: (patch) => { for (const key of Object.keys(patch) as UiPreferenceKey[]) if (unsaved[key] === patch[key]) delete unsaved[key]; },
}));
export function queueUiPreferenceSave<K extends UiPreferenceKey>(key: K, value: UiPreferences[K]) {
  unsaved = { ...unsaved, [key]: value };
  uiPreferenceSaves.edit(unsaved, "now");
}

