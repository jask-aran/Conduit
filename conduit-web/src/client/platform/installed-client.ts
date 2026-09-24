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

/**
 * A browser that was installed to the home screen, which is a different thing
 * from an installed client.
 *
 * It has no shell and no secure store -- it is a page, with a page's cookie,
 * storage and service worker, all belonging to the one origin that served it.
 * That is the whole difficulty: a tab can be sent to another address and come
 * back, but this cannot. Navigating away from a standalone window either
 * leaves the app or opens a browser on top of it, and either way the person
 * has been ejected from the thing they opened.
 *
 * So it is asked about separately from `isInstalledClient`, and only ever to
 * say that a route cannot be changed from here, never to offer the move.
 */
export const isStandaloneBrowser = (): boolean => {
  if (installedClientKind !== "browser" || typeof matchMedia !== "function") return false;
  // iOS answers the second and not the first.
  return matchMedia("(display-mode: standalone)").matches
    || matchMedia("(display-mode: fullscreen)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
};

/** Whether this client can move to another address at all, by any means. */
export const canReachOtherOrigins = () => isInstalledClient() || !isStandaloneBrowser();

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
/**
 * Android replaces its shell by handing the APK to the system, which asks
 * before installing anything. That confirmation cannot be suppressed for an
 * app installed outside the Play Store, and should not be: it is the only
 * thing standing between a download and code running on the phone. So this
 * finds the release and opens it, and Android takes it from there.
 */
export const androidShell = installedClientKind !== "android" ? null : {
  async version(): Promise<string | null> {
    try {
      const { App } = await import("@capacitor/app");
      return (await App.getInfo()).version;
    } catch {
      return null;
    }
  },
  /**
   * Returns the version it sent to the installer, or null when the running
   * build is already the latest. The download leaves the app, so nothing
   * after this reports back.
   */
  async update(): Promise<string | null> {
    const { isNewerVersion, latestRelease } = await import("./github-release.ts");
    const release = await latestRelease();
    if (!release?.apkUrl) return null;
    const { App } = await import("@capacitor/app");
    const current = (await App.getInfo()).version;
    if (!isNewerVersion(release.version, current)) return null;
    // Opened outside the webview, so the browser downloads it and Android's
    // package installer is what the person confirms.
    window.open(release.apkUrl, "_blank");
    return release.version;
  },
};

export interface UpdateProgress {
  version: string;
  downloaded: number;
  total: number;
}

export type PreparedDesktopUpdate = { kind: "current" } | { kind: "ready"; version: string };

// App remounts when an installed client changes servers. Keep the verified
// download outside that tree, so switching servers does not discard it.
let readyDesktopUpdate: import("@tauri-apps/plugin-updater").Update | null = null;
let desktopUpdatePreparation: Promise<PreparedDesktopUpdate> | null = null;

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
  /** Download and verify now; install only after the person takes the update. */
  async prepareUpdate(onProgress?: (update: UpdateProgress) => void): Promise<PreparedDesktopUpdate> {
    if (readyDesktopUpdate) return { kind: "ready", version: readyDesktopUpdate.version };
    if (desktopUpdatePreparation) return desktopUpdatePreparation;
    desktopUpdatePreparation = (async (): Promise<PreparedDesktopUpdate> => {
      const { check } = await import("@tauri-apps/plugin-updater");
      const pending = await check();
      if (!pending) return { kind: "current" };
      let downloaded = 0;
      let total = 0;
      try {
        await pending.download((event) => {
          if (event.event === "Started") {
            total = event.data.contentLength || 0;
            downloaded = 0;
          } else if (event.event === "Progress") {
            downloaded += event.data.chunkLength;
          }
          onProgress?.({ version: pending.version, downloaded, total });
        });
        readyDesktopUpdate = pending;
        return { kind: "ready", version: pending.version };
      } catch (error) {
        await pending.close();
        throw error;
      }
    })();
    try {
      return await desktopUpdatePreparation;
    } finally {
      desktopUpdatePreparation = null;
    }
  },
  /** The configured NSIS quiet mode installs and relaunches on Windows. */
  async installPreparedUpdate(): Promise<boolean> {
    if (!readyDesktopUpdate) return false;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("remember_update_window");
    await readyDesktopUpdate.install({ restartAfterInstall: true });
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
