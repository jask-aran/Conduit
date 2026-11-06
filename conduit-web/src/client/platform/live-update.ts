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
 * On its own it only moves forward: an interface built before the one running is not taken, so switching between
 * servers on different builds does not swap the interface back and forth. Check for updates by hand takes whatever
 * the connected server serves.
 */

/** Whether the server's interface was built after this one (its manifest's `builtAt`); unknown is not newer. */
async function serverIsNewer(server: string): Promise<boolean> {
  try {
    const response = await authorizedFetch(`${server}/client-bundle/manifest.json`, { signal: AbortSignal.timeout(5000) });
    const { builtAt } = await response.json() as { builtAt?: string };
    const theirs = Date.parse(builtAt || ""), ours = Date.parse(clientBuild.builtAt || "");
    return Number.isFinite(theirs) && (!Number.isFinite(ours) || theirs > ours);
  } catch { return false; }
}
import { installedClientKind } from "./installed-client.ts";
import { authorizedFetch } from "../api/native-auth-client.ts";
import { clientBuild } from "./build-info.ts";
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
let checking = false;
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
      if (!(await serverIsNewer(server))) { staged = null; return; }
      const result = await plugin.stageBundle({ origin: server });
      staged = result.state === "staged" ? result.build : null;
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
  void check();
  await App.addListener("resume", () => void check());
  await App.addListener("pause", () => {
    if (staged) { rememberView(); void plugin.applyBundle({ build: staged }).catch(() => {}); }
  });
}

/** Stop a download under way, of an interface or an APK (they share the native worker). */
export async function cancelUpdateDownload(): Promise<void> {
  if (installedClientKind !== "android") return;
  const { registerPlugin } = await import("@capacitor/core");
  await registerPlugin<BundlePlugin>("ConduitUpdater").cancel().catch(() => {});
}
