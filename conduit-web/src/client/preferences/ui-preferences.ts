import { createRoot } from "solid-js";
import { api } from "../api/client.ts";
import { createAutosave } from "../settings/autosave.ts";

export const UI_PREFERENCE_CHANGE_EVENT = "conduit:ui-preference-change";

export interface UiPreferences {
  sidebarChatLimit: number | null;
  collapsedProjectIds: string[] | null;
  sidebarCollapsed: boolean | null;
  markdownRenderer: string | null;
  composerSurface: string | null;
  meteorField: boolean | null;
  incremarkPacing: string | null;
  transcriptWidth: string | null;
  transcriptWideBlocks: string | null;
  codeBlockCollapse: string | null;
  codeBlockCollapseLines: number | null;
  codeBlockWidth: string | null;
  panelMotion: string | null;
  leaderMenu: string | null;
  userMessageCollapse: string | null;
  chatSort: string | null;
  shortcutOverrides: Record<string, unknown> | null;
  voicePreferences: Record<string, unknown> | null;
  sidebarPins: string[] | null;
}

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

export async function saveUiPreference<K extends UiPreferenceKey>(key: K, value: UiPreferences[K]) {
  return api<UiPreferences>("/v0/preferences", {
    method: "PATCH",
    body: JSON.stringify({ [key]: value }),
  });
}
