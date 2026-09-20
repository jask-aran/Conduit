/**
 * One question, asked once: is this an installed client talking to a Conduit
 * server somewhere else?
 *
 * A browser is served by the server it talks to, so it has a same-origin
 * session cookie, a login redirect and a service worker. An installed client
 * has none of those: it holds a bearer token in the platform's secure store,
 * addresses a server the user chose, and takes its updates from its own
 * channel. Android and Windows differ in how they store that token and how
 * they update -- they do not differ in any of the behaviour above, so every
 * call site asks `isInstalledClient()` and only this file knows which shell
 * it is running in.
 */
import { Capacitor } from "@capacitor/core";

export type InstalledClientKind = "browser" | "android" | "desktop";

// Tauri 2 stamps this on the window before the bundle's first script runs.
declare global {
  interface Window { __TAURI_INTERNALS__?: unknown }
}

function detect(): InstalledClientKind {
  if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) return "desktop";
  return Capacitor.isNativePlatform() ? "android" : "browser";
}

export const installedClientKind: InstalledClientKind = detect();

export const isInstalledClient = () => installedClientKind !== "browser";

/** Where the bearer token lives. Never `localStorage`, on any installed shell. */
export interface SecureTokenStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const androidStore = (): SecureTokenStore => ({
  async get(key) {
    const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
    const value = await SecureStorage.get(key);
    return typeof value === "string" && value ? value : null;
  },
  async set(key, value) {
    const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
    await SecureStorage.set(key, value);
  },
  async remove(key) {
    const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
    await SecureStorage.remove(key);
  },
});

// The desktop shell answers these from the OS credential store -- Windows
// Credential Manager, keyed to the signed-in user -- so nothing is kept in a
// file the webview could read back. The web half never learns which store it
// is talking to, exactly as on Android.
const desktopStore = (): SecureTokenStore => ({
  async get(key) {
    const { invoke } = await import("@tauri-apps/api/core");
    const value = await invoke<string | null>("secret_get", { key });
    return value || null;
  },
  async set(key, value) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("secret_set", { key, value });
  },
  async remove(key) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("secret_remove", { key });
  },
});

const browserStore = (): SecureTokenStore => ({
  async get() { return null; },
  async set() { /* a browser authenticates with its session cookie */ },
  async remove() { /* nothing was stored */ },
});

export const secureTokenStore: SecureTokenStore = installedClientKind === "desktop"
  ? desktopStore()
  : installedClientKind === "android" ? androidStore() : browserStore();

/** What the desktop shell decides before the client has loaded. */
export interface DesktopShellSettings {
  keepRunningInTray: boolean;
  launchAtLogin: boolean;
  startHidden: boolean;
}

/**
 * The desktop shell's own surface: the window lifecycle it owns, and the tray
 * actions it hands back. Null on every other client, which is what the Settings
 * tile and the tray listener check rather than asking which shell this is.
 */
export const desktopShell = installedClientKind !== "desktop" ? null : {
  async settings(): Promise<DesktopShellSettings> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<DesktopShellSettings>("desktop_settings");
  },
  // Returns what the shell ended up with: the OS registration for launch-at-
  // login can refuse, and the caller must show what is true rather than what
  // was asked for.
  async saveSettings(settings: DesktopShellSettings): Promise<DesktopShellSettings> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<DesktopShellSettings>("set_desktop_settings", { settings });
  },
  async onNewChat(handler: () => void): Promise<() => void> {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("desktop://new-chat", () => handler());
  },
};
