/**
 * Development clients (`.dev`) take the interface the connected server serves, older or newer, since the two are one
 * build; a release client must not take whatever interface its server happens to run.
 */
import { createSignal } from "solid-js";
import { installedClientKind } from "./installed-client.ts";
import { authorizedFetch } from "../api/native-auth-client.ts";
import { rememberView } from "./resume-view.ts";

export interface BundleProgress { phase: "checking" | "downloading"; downloaded: number; total: number }

interface BundlePlugin {
  stageBundle(options: { origin: string }): Promise<{ state: "current" | "staged"; build: string }>;
  applyBundle(options: { build: string }): Promise<void>;
  confirmBundle(): Promise<{ build?: string }>;
  cancel(): Promise<void>;
  addListener(event: "bundleProgress", listener: (progress: BundleProgress) => void): Promise<{ remove(): Promise<void> }>;
}

let staged: string | null = null;
const [interfaceReady, setInterfaceReady] = createSignal(false);
export { interfaceReady };
let applyStaged: (() => Promise<unknown>) | null = null;
export function applyStagedInterface() { return applyStaged?.(); }
const stage = (build: string | null) => { staged = build; setInterfaceReady(Boolean(build)); };
let checking = false;
let swap: ((server: string) => Promise<boolean>) | null = null;
let now: ((onProgress?: (progress: BundleProgress) => void) => Promise<"current" | "applying" | "unreachable" | "cancelled">) | null = null;

/** Null when this client does not live-update. */
export function liveUpdateNow(onProgress?: (progress: BundleProgress) => void) {
  return now ? now(onProgress) : null;
}

export async function startLiveUpdate(origin: () => string | null): Promise<void> {
  if (installedClientKind === "desktop") return startDesktopLiveUpdate(origin);
  if (installedClientKind !== "android") return;
  const [{ registerPlugin }, { App }] = await Promise.all([import("@capacitor/core"), import("@capacitor/app")]);
  if (!(await App.getInfo()).id.endsWith(".dev")) return;
  const plugin = registerPlugin<BundlePlugin>("ConduitUpdater");
  // Without this the app goes back to the bundled interface on its next launch.
  await plugin.confirmBundle().catch(() => {});
  const check = async () => {
    const server = origin();
    if (!server || checking) return;
    checking = true;
    try {
      const result = await plugin.stageBundle({ origin: server });
      stage(result.state === "staged" ? result.build : null);
    } catch {
      // Unreachable, or a server without bundles: try again later.
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
  window.addEventListener("conduit:updates-offered", () => void check());
  void check();
  await App.addListener("resume", () => void check());
  await App.addListener("pause", () => {
    if (staged) { rememberView(); void plugin.applyBundle({ build: staged }).catch(() => {}); }
  });
}

// The desktop page downloads the zip itself because it already knows the route and the trust; the shell unpacks it.
// A background check and a Check for updates can overlap, so Cancel stops each download.
const desktopDownloads = new Set<AbortController>();

async function startDesktopLiveUpdate(origin: () => string | null): Promise<void> {
  const [{ invoke }, { getIdentifier }] = await Promise.all([import("@tauri-apps/api/core"), import("@tauri-apps/api/app")]);
  if (!(await getIdentifier()).endsWith(".dev")) return;
  // Without this the shell goes back to its built-in interface at the next launch.
  await invoke("interface_confirm").catch(() => {});
  /** Null when the interface running is the one the server serves. */
  const download = async (server: string, onProgress?: (progress: BundleProgress) => void): Promise<string | null> => {
    onProgress?.({ phase: "checking", downloaded: 0, total: 0 });
    const manifest = await authorizedFetch(`${server}/client-bundle/manifest.json`, { signal: AbortSignal.timeout(10_000) });
    const { build } = await manifest.json() as { build?: string };
    if (!build || build === await invoke<string>("interface_build")) return null;
    const controller = new AbortController();
    desktopDownloads.add(controller);
    try {
      const response = await authorizedFetch(`${server}/client-bundle/${build}.zip`, { signal: controller.signal });
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
      desktopDownloads.delete(controller);
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
      // Unreachable, or a server without bundles: try again later.
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
  // The interval is only for a hub that does not push its offers.
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

/** True when the page is reloading into `server`'s interface. */
export async function swapInterface(server: string): Promise<boolean> {
  try { return await swap?.(server) ?? false; } catch { return false; }
}

/** Also stops an APK download: it shares the native worker. */
export async function cancelUpdateDownload(): Promise<void> {
  for (const controller of desktopDownloads) controller.abort();
  if (installedClientKind !== "android") return;
  const { registerPlugin } = await import("@capacitor/core");
  await registerPlugin<BundlePlugin>("ConduitUpdater").cancel().catch(() => {});
}
