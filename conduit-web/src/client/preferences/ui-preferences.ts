import { api } from "../api/client";

export const UI_PREFERENCE_CHANGE_EVENT = "conduit:ui-preference-change";

export interface UiPreferences {
  sidebarChatLimit: number | null;
  collapsedProjectIds: string[] | null;
  sidebarCollapsed: boolean | null;
  markdownRenderer: string | null;
  transcriptRenderer: string | null;
  rendererControlsVisible: boolean | null;
  composerSurface: string | null;
  contextMetrics: string[] | null;
  meteorField: boolean | null;
  incremarkPacing: string | null;
  shortcutOverrides: Record<string, unknown> | null;
  voicePreferences: Record<string, unknown> | null;
}

export type UiPreferenceKey = keyof UiPreferences;

export function publishUiPreference<K extends UiPreferenceKey>(key: K, value: UiPreferences[K]) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(UI_PREFERENCE_CHANGE_EVENT, { detail: { key, value } }));
  }
  return value;
}

export async function saveUiPreference<K extends UiPreferenceKey>(key: K, value: UiPreferences[K]) {
  return api<UiPreferences>("/v0/preferences", {
    method: "PATCH",
    body: JSON.stringify({ [key]: value }),
  });
}
