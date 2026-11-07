/**
 * Live update of an installed Android development client's interface.
 *
 * The app keeps launching from the interface on the device -- bundling it is
 * what makes launch instant and offline -- and takes the one the connected
 * server serves in the background: downloaded and unpacked whole
 * (`ConduitUpdaterPlugin.stageBundle`), then swapped in while the app is out
 * of sight, so the next look at it is the new build. Native changes still need
 * a new APK.
 *
 * Development builds only (`.dev`): a release client must not take whatever
 * interface the server it points at happens to run.
 *
 * Each server's own interface, older or newer: the interface and the server it talks to are one build, so the
 * interface follows the server connected to. A switch to a server on another build swaps it before anything is drawn
 * (`swapInterface`); the native side keeps the one shown before, so switching back is no download.
 */
import { createSignal } from "solid-js";
import { installedClientKind } from "./installed-client.ts";
import { authorizedFetch } from "../api/native-auth-client.ts";
import { rememberView } from "./resume-view.ts";

/** Where a fetch of the server's interface is: asking which build it serves, then downloading it. */
export interface BundleProgress { phase: "checking" | "downloading"; downloaded: number; total: number }

interface BundlePlugin {
  stageBundle(options: { origin: string }): Promise<{ state: "current" | "staged"; build: string }>;
  applyBundle(options: { build: string }): Promise<void>;
  confirmBundle(): Promise<{ build?: string }>;
  cancel(): Promise<void>;
  addListener(event: "bundleProgress", listener: (progress: BundleProgress) => void): Promise<{ remove(): Promise<void> }>;
}

let staged: string | null = null;
/* A staged interface is said (the title bar's Update): taken by hand at once, or at the next time out of sight. */
const [interfaceReady, setInterfaceReady] = createSignal(false);
export { interfaceReady };
let applyStaged: (() => Promise<unknown>) | null = null;
/** Swap the staged interface in now (the page reloads into it). */
export function applyStagedInterface() { return applyStaged?.(); }
const stage = (build: string | null) => { staged = build; setInterfaceReady(Boolean(build)); };
let checking = false;
let swap: ((server: string) => Promise<boolean>) | null = null;
let now: ((onProgress?: (progress: BundleProgress) => void) => Promise<"current" | "applying" | "unreachable" | "cancelled">) | null = null;

/**
 * Check for updates, pressed by hand on a development client: take the
 * connected server's interface now (the page reloads into it) rather than at
 * the next app switch. Null when this client does not live-update.
 */
export function liveUpdateNow(onProgress?: (progress: BundleProgress) => void) {
  return now ? now(onProgress) : null;
}

export async function startLiveUpdate(origin: () => string | null): Promise<void> {
  if (installedClientKind === "desktop") return startDesktopLiveUpdate(origin);
  if (installedClientKind !== "android") return;
  const [{ registerPlugin }, { App }] = await Promise.all([import("@capacitor/core"), import("@capacitor/app")]);
  if (!(await App.getInfo()).id.endsWith(".dev")) return;
  const plugin = registerPlugin<BundlePlugin>("ConduitUpdater");
  // This interface started; without this the app goes back to the bundled
  // one on its next launch.
  await plugin.confirmBundle().catch(() => {});
  const check = async () => {
    const server = origin();
    if (!server || checking) return;
    checking = true;
    try {
      const result = await plugin.stageBundle({ origin: server });
      stage(result.state === "staged" ? result.build : null);
    } catch {
      // Unreachable, or an older server without bundles: try again later.
    } finally {
      checking = false;
    }
  };
  now = async (onProgress) => {
    const server = origin();
    if (!server) return "unreachable";
    const listener = onProgress ? await plugin.addListener("bundleProgress", onProgress) : null;
    try {
      const result = await plugin.stageBundle({ origin: server });
      if (result.state !== "staged") return "current";
      rememberView();
      await plugin.applyBundle({ build: result.build });
      return "applying";
    } catch (error) {
      return error instanceof Error && error.message === "Cancelled" ? "cancelled" : "unreachable";
    } finally {
      void listener?.remove();
    }
  };
  applyStaged = async () => { if (staged) { rememberView(); await plugin.applyBundle({ build: staged }); } };
  swap = async (server) => {
    const result = await plugin.stageBundle({ origin: server });
    if (result.state !== "staged") return false;
    await plugin.applyBundle({ build: result.build });
    return true;
  };
  // The hub pushes what it offers (runtime stream): a new interface is staged as soon as it is there.
  window.addEventListener("conduit:updates-offered", () => void check());
  void check();
  await App.addListener("resume", () => void check());
  await App.addListener("pause", () => {
    if (staged) { rememberView(); void plugin.applyBundle({ build: staged }).catch(() => {}); }
  });
}

/*
 * The desktop development client does the same through its shell (src-tauri interface_bundle.rs): the page downloads
 * the server's interface -- it already knows the route and the trust -- and hands the zip over to be unpacked; it is
 * swapped in when the window is out of sight (minimised or in the tray), or at once by Check for updates.
 */
let desktopDownload: AbortController | null = null;

async function startDesktopLiveUpdate(origin: () => string | null): Promise<void> {
  const [{ invoke }, { getIdentifier }] = await Promise.all([import("@tauri-apps/api/core"), import("@tauri-apps/api/app")]);
  if (!(await getIdentifier()).endsWith(".dev")) return;
  // This interface started; without this the shell goes back to its built-in one at the next launch.
  await invoke("interface_confirm").catch(() => {});
  /** Stage the server's interface; its build when one was staged, null when this one is what it serves. */
  const download = async (server: string, onProgress?: (progress: BundleProgress) => void): Promise<string | null> => {
    onProgress?.({ phase: "checking", downloaded: 0, total: 0 });
    const manifest = await authorizedFetch(`${server}/client-bundle/manifest.json`, { signal: AbortSignal.timeout(10_000) });
    const { build } = await manifest.json() as { build?: string };
    if (!build || build === await invoke<string>("interface_build")) return null;
    desktopDownload = new AbortController();
    try {
      const response = await authorizedFetch(`${server}/client-bundle/${build}.zip`, { signal: desktopDownload.signal });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      const total = Number(response.headers.get("content-length")) || 0;
      const reader = response.body.getReader();
      const parts: Uint8Array[] = [];
      let downloaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        downloaded += value.length;
        onProgress?.({ phase: "downloading", downloaded, total });
      }
      const zip = new Uint8Array(downloaded);
      let at = 0;
      for (const part of parts) { zip.set(part, at); at += part.length; }
      return await invoke<string>("interface_stage", zip, { headers: { "x-build": build } });
    } finally {
      desktopDownload = null;
    }
  };
  const apply = (build: string) => { rememberView(); return invoke("interface_apply", { build }); };
  const check = async () => {
    const server = origin();
    if (!server || checking) return;
    checking = true;
    try {
      stage(await download(server));
    } catch {
      // Unreachable, or an older server without bundles: try again later.
    } finally {
      checking = false;
    }
  };
  now = async (onProgress) => {
    const server = origin();
    if (!server) return "unreachable";
    try {
      const build = await download(server, onProgress);
      if (!build) return "current";
      await apply(build);
      return "applying";
    } catch (error) {
      return (error as Error | null)?.name === "AbortError" ? "cancelled" : "unreachable";
    }
  };
  applyStaged = async () => { if (staged) await apply(staged); };
  swap = async (server) => {
    const build = await download(server);
    if (!build) return false;
    await invoke("interface_apply", { build });
    return true;
  };
  void check();
  // The hub pushes what it offers (runtime stream): a new interface is staged as soon as it is there. Asking now and
  // then as well is only for a hub that does not push.
  window.addEventListener("conduit:updates-offered", () => { lastCheck = Date.now(); void check(); });
  setInterval(() => { lastCheck = Date.now(); void check(); }, 60 * 60_000);
  let lastCheck = Date.now();
  const again = () => { if (Date.now() - lastCheck > 60_000) { lastCheck = Date.now(); void check(); } };
  window.addEventListener("focus", again);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") again();
    else if (staged) void apply(staged).catch(() => {});
  });
}

/**
 * Take the interface `server` serves before drawing anything for it: true when the page is reloading into it, false
 * when the one running is already that server's (or the server cannot say), so the app is drawn as it is.
 */
export async function swapInterface(server: string): Promise<boolean> {
  try { return await swap?.(server) ?? false; } catch { return false; }
}

/** Stop a download under way, of an interface or an APK (they share the native worker). */
export async function cancelUpdateDownload(): Promise<void> {
  desktopDownload?.abort();
  if (installedClientKind !== "android") return;
  const { registerPlugin } = await import("@capacitor/core");
  await registerPlugin<BundlePlugin>("ConduitUpdater").cancel().catch(() => {});
}
