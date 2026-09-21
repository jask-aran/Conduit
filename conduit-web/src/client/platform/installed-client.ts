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
export interface UpdateProgress {
  phase: "downloading" | "installing";
  version: string;
  downloaded: number;
  total: number;
}

export interface GlobalShortcut {
  accelerator: string;
  commandId: string;
}

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
  /**
   * The whole update, shell and client together: they are one artifact, so
   * there is no version of Conduit where half of it has been replaced. Returns
   * false when there was nothing to install; a true return is followed by a
   * relaunch, so nothing after it runs.
   *
   * The progress it reports is Conduit's own -- the installer runs silently --
   * so the whole update reads as one action in one window rather than a
   * download followed by somebody else's dialog.
   */
  async update(onProgress?: (update: UpdateProgress) => void): Promise<boolean> {
    const { check } = await import("@tauri-apps/plugin-updater");
    const pending = await check();
    if (!pending) return false;
    let downloaded = 0;
    let total = 0;
    await pending.downloadAndInstall((event) => {
      if (!onProgress) return;
      if (event.event === "Started") {
        total = event.data.contentLength || 0;
        downloaded = 0;
        onProgress({ phase: "downloading", version: pending.version, downloaded, total });
        return;
      }
      if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        onProgress({ phase: "downloading", version: pending.version, downloaded, total });
        return;
      }
      onProgress({ phase: "installing", version: pending.version, downloaded: total, total });
    });
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
    return true;
  },
  async onNewChat(handler: () => void): Promise<() => void> {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("desktop://new-chat", () => handler());
  },
  async onCheckForUpdates(handler: () => void): Promise<() => void> {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("desktop://check-for-updates", () => handler());
  },
  /**
   * Hand the shell the whole set of system-wide keys. It is a replacement, not
   * an addition, so the client's registry stays the only account of what is
   * bound; the shell either takes all of it or keeps what it had and says which
   * chord another application owns.
   */
  async setGlobalShortcuts(shortcuts: GlobalShortcut[]): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_global_shortcuts", { shortcuts });
  },
  /** A system-wide key fired: the payload is a command id from the registry. */
  async onCommand(handler: (commandId: string) => void): Promise<() => void> {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<string>("desktop://command", (event) => handler(event.payload));
  },
};
