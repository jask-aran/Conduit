import { createSignal } from "solid-js";
/** Every call site asks `isInstalledClient()`; only this file knows which shell it is running in. */
import { Capacitor } from "@capacitor/core";
import type { DownloadsPayload } from "../api/contracts.ts";

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
 * A home-screen browser is a page bound to the origin that served it, and navigating away ejects the person from it,
 * so this only ever says that a route cannot be changed from here.
 */
export const isStandaloneBrowser = (): boolean => {
  if (installedClientKind !== "browser" || typeof matchMedia !== "function") return false;
  // iOS answers the second and not the first.
  return matchMedia("(display-mode: standalone)").matches
    || matchMedia("(display-mode: fullscreen)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
};

export const canReachOtherOrigins = () => isInstalledClient() || !isStandaloneBrowser();

/** Never `localStorage`, on any installed shell. */
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
  async remove() {},
});

export const secureTokenStore: SecureTokenStore = installedClientKind === "desktop"
  ? desktopStore()
  : installedClientKind === "android" ? androidStore() : browserStore();

/**
 * Android's install confirmation cannot be suppressed outside the Play Store, so the APK is downloaded ahead of time
 * and taking the update only opens the installer on it.
 */
interface UpdaterPlugin {
  download(options: { url: string; version: string; unmeteredOnly: boolean }): Promise<{ ready: boolean }>;
  install(options: { version: string }): Promise<{ needsPermission?: boolean }>;
  addListener(event: "progress", listener: (progress: { downloaded: number; total: number }) => void): Promise<{ remove(): Promise<void> }>;
}
// Held in an object: a plugin has a `then` (any name is a native method), so a promise resolving to one never settles.
let androidUpdater: Promise<{ plugin: UpdaterPlugin }> | null = null;
const updater = () => androidUpdater ??= import("@capacitor/core").then(({ registerPlugin }) => ({ plugin: registerPlugin<UpdaterPlugin>("ConduitUpdater") }));
let readyAndroidVersion: string | null = null;

/**
 * A released app takes GitHub's latest release; the development app takes the newest development APK its server
 * publishes, by the build stamp in its version, so a native change reaches the phone as an update.
 */
async function androidRelease(): Promise<{ version: string; apkUrl: string } | null> {
  const { App } = await import("@capacitor/app");
  const app = await App.getInfo();
  if (!app.id.endsWith(".dev")) {
    const { isNewerVersion, latestRelease } = await import("./github-release.ts");
    const release = await latestRelease();
    return release?.apkUrl && isNewerVersion(release.version, app.version) ? { version: release.version, apkUrl: release.apkUrl } : null;
  }
  const [{ api }, { httpUrl }] = await Promise.all([import("../api/client.ts"), import("../api/transport.js")]);
  const own = await api<DownloadsPayload>("/v0/downloads").catch(() => null);
  // An app built without a stamp is older than any stamped build.
  const stamp = (version: string) => version.match(/-dev\.(\d{14})\./)?.[1] ?? "";
  if (!own?.apkUrl || !own.apkVersion || stamp(own.apkVersion) <= stamp(app.version)) return null;
  return { version: own.apkVersion, apkUrl: new URL(httpUrl(own.apkUrl), location.href).href };
}

export const androidShell = installedClientKind !== "android" ? null : {
  async version(): Promise<string | null> {
    try {
      const { App } = await import("@capacitor/app");
      return (await App.getInfo()).version;
    } catch {
      return null;
    }
  },
  /** A quiet (background) check waits for an unmetered network. */
  async prepareUpdate(onProgress?: (update: UpdateProgress) => void, quiet = false): Promise<PreparedDesktopUpdate> {
    if (readyAndroidVersion) return { kind: "ready", version: readyAndroidVersion };
    const release = await androidRelease();
    if (!release) return { kind: "current" };
    const { plugin } = await updater();
    const listener = await plugin.addListener("progress", (progress) => onProgress?.({ version: release.version, ...progress }));
    // Says the download began: the first progress event comes only after half a megabyte.
    onProgress?.({ version: release.version, downloaded: 0, total: 0 });
    try {
      const { ready } = await plugin.download({ url: release.apkUrl, version: release.version, unmeteredOnly: quiet });
      if (!ready) return { kind: "current" };
      readyAndroidVersion = release.version;
      return { kind: "ready", version: release.version };
    } finally {
      void listener.remove();
    }
  },
  async installPreparedUpdate(): Promise<boolean> {
    if (!readyAndroidVersion) return false;
    const { needsPermission } = await (await updater()).plugin.install({ version: readyAndroidVersion });
    // Sent to the "install unknown apps" grant; the update stays ready.
    if (needsPermission) throw new Error("Allow Conduit to install updates, then take the update again.");
    return true;
  },
};

export interface UpdateProgress {
  version: string;
  downloaded: number;
  total: number;
}

export type PreparedDesktopUpdate = { kind: "current" } | { kind: "ready"; version: string };

// App remounts when an installed client changes servers; the verified download lives outside it to survive that.
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
  serveAsDevice: boolean;
  titleBar: DesktopTitleBar;
}
export type DesktopTitleBar = "native" | "none" | "conduit";
/** Conduit's until the shell says, so the usual window does not draw without its bar first. */
export const [desktopTitleBar, setDesktopTitleBar] = createSignal<DesktopTitleBar>("conduit");

export interface CompanionRoot { id: string; path: string; read: boolean; write: boolean; shell: boolean }
export interface CompanionStatus {
  available: boolean;
  serving: boolean;
  running: boolean;
  node: { name: string | null; host?: string; pairings: Array<{ mainUrl: string; nodeId: string | null; routes?: string[]; roots: CompanionRoot[]; browse?: boolean; newFolders?: { write: boolean; shell: boolean } }> } | null;
}

export const desktopShell = installedClientKind !== "desktop" ? null : {
  companion: {
    async status(): Promise<CompanionStatus> {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<CompanionStatus>("device_companion_status");
    },
    /** `via`: other ways to reach the server, tried when `mainUrl` is not reachable. */
    async pair(mainUrl: string, key: string, nodeId: string, name: string, via: string[] = []): Promise<string> {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<string>("device_companion_pair", { mainUrl, key, nodeId, name, via });
    },
    async share(mainUrl: string, write: boolean, shell: boolean): Promise<string | null> {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<string | null>("device_companion_share", { mainUrl, write, shell });
    },
    async unshare(mainUrl: string, path: string): Promise<void> {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("device_companion_unshare", { mainUrl, path });
    },
    async browse(mainUrl: string, on: boolean): Promise<void> {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("device_companion_browse", { mainUrl, on });
    },
    async newFolders(mainUrl: string, write: boolean, shell: boolean): Promise<void> {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("device_companion_new_folders", { mainUrl, write, shell });
    },
    async unpair(mainUrl: string): Promise<void> {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("device_companion_unpair", { mainUrl });
    },
  },
  async settings(): Promise<DesktopShellSettings> {
    const { invoke } = await import("@tauri-apps/api/core");
    const found = await invoke<DesktopShellSettings>("desktop_settings");
    setDesktopTitleBar(found.titleBar ?? "conduit");
    return found;
  },
  // The OS can refuse launch-at-login, so the caller shows what the shell ended up with, not what was asked for.
  async saveSettings(settings: DesktopShellSettings): Promise<DesktopShellSettings> {
    const { invoke } = await import("@tauri-apps/api/core");
    const saved = await invoke<DesktopShellSettings>("set_desktop_settings", { settings });
    setDesktopTitleBar(saved.titleBar ?? "conduit");
    return saved;
  },
  window: {
    minimize: async () => (await import("@tauri-apps/api/window")).getCurrentWindow().minimize(),
    toggleMaximize: async () => (await import("@tauri-apps/api/window")).getCurrentWindow().toggleMaximize(),
    close: async () => (await import("@tauri-apps/api/window")).getCurrentWindow().close(),
    isMaximized: async () => (await import("@tauri-apps/api/window")).getCurrentWindow().isMaximized(),
    watchMaximized: async (seen: (maximized: boolean) => void) => {
      const current = (await import("@tauri-apps/api/window")).getCurrentWindow();
      seen(await current.isMaximized());
      return current.onResized(async () => seen(await current.isMaximized()));
    },
  },
  async prepareUpdate(onProgress?: (update: UpdateProgress) => void, _quiet = false): Promise<PreparedDesktopUpdate> {
    if (readyDesktopUpdate) return { kind: "ready", version: readyDesktopUpdate.version };
    if (desktopUpdatePreparation) return desktopUpdatePreparation;
    desktopUpdatePreparation = (async (): Promise<PreparedDesktopUpdate> => {
      const [{ check, Update }, { getIdentifier }] = await Promise.all([
        import("@tauri-apps/plugin-updater"), import("@tauri-apps/api/app"),
      ]);
      let pending: InstanceType<typeof Update> | null = null;
      // A server that answered "nothing newer" is the answer: the built-in endpoint is only for when none answered.
      let answered = false;
      const unanswered: string[] = [];
      if (await getIdentifier() === "com.jaskaran.conduit.desktop.dev") {
        const [{ activePath, activeServer, pathsOf }, { invoke }] = await Promise.all([
          import("./servers.ts"), import("@tauri-apps/api/core"),
        ]);
        // Every address this server is known by: the route in use can have just gone away.
        const entry = activeServer();
        const routes = [...new Set([activePath(), ...(entry ? pathsOf(entry).map((path) => path.origin) : [])])];
        for (const route of routes) {
          if (!route) continue;
          const endpoint = new URL("/desktop-updates/latest.json", route).href;
          try {
            const metadata = await invoke<ConstructorParameters<typeof Update>[0] | null>("check_dev_update", { endpoint });
            if (metadata) pending = new Update(metadata);
            answered = true;
            break;
          } catch (error) {
            unanswered.push(`${endpoint} (${error instanceof Error ? error.message : String(error)})`);
          }
        }
      }
      // The built-in endpoint's error alone names an address the person never chose, so say which of theirs were tried.
      if (!pending && !answered) {
        try {
          pending = await check();
        } catch (error) {
          if (!unanswered.length) throw error;
          throw new Error(`No update source answered. Tried ${unanswered.join(", ")}; built-in endpoint: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
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
   * A replacement, not an addition, so the client's registry stays the only account of what is bound; the shell takes
   * all of it or keeps what it had and says which chord another application owns.
   */
  async setGlobalShortcuts(shortcuts: GlobalShortcut[]): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_global_shortcuts", { shortcuts });
  },
  async onCommand(handler: (commandId: string) => void): Promise<() => void> {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<string>("desktop://command", (event) => handler(event.payload));
  },
};
