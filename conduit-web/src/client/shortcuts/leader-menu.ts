import { createSignal } from "solid-js";
import { publishUiPreference, type UiPreferenceChoice } from "../preferences/ui-preferences";
import { UI_PREFERENCES } from "../../preferences-api.js";

/** By default only after a pause, so someone who knows the key they want never sees it. */
export type LeaderMenuMode = UiPreferenceChoice<"leaderMenu">;
const LEADER_MENU_MODES = new Set<string>(UI_PREFERENCES.leaderMenu.values);

export const LEADER_MENU_STORAGE_KEY = "conduit:leader-menu";
export const LEADER_MENU_PAUSE_MS = 450;
export const LEADER_MENU_OPTIONS: ReadonlyArray<{ value: LeaderMenuMode; label: string }> = [
  { value: "pause", label: "After a pause" },
  { value: "immediate", label: "At once" },
  { value: "never", label: "Never" },
];

export function isLeaderMenuMode(value: unknown): value is LeaderMenuMode {
  return typeof value === "string" && LEADER_MENU_MODES.has(value);
}

export function selectedLeaderMenu(storage: Pick<Storage, "getItem"> = localStorage): LeaderMenuMode {
  try {
    const stored = storage.getItem(LEADER_MENU_STORAGE_KEY);
    return isLeaderMenuMode(stored) ? stored : "pause";
  } catch { return "pause"; }
}

const [leaderMenu, setLeaderMenuSignal] = createSignal<LeaderMenuMode>(selectedLeaderMenu());
export { leaderMenu };

/** Applied from the server's copy; stored, not announced back. */
export function setLeaderMenu(mode: LeaderMenuMode) {
  setLeaderMenuSignal(mode);
}

/** Chosen in settings: stored, and announced so the server keeps it. */
export function saveLeaderMenu(mode: LeaderMenuMode) {
  try { localStorage.setItem(LEADER_MENU_STORAGE_KEY, mode); } catch { /* the signal still holds it */ }
  setLeaderMenuSignal(mode);
  publishUiPreference("leaderMenu", mode);
}
