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
 */
import { installedClientKind } from "./installed-client.ts";

interface BundlePlugin {
  stageBundle(options: { origin: string }): Promise<{ state: "current" | "staged"; build: string }>;
  applyBundle(options: { build: string }): Promise<void>;
  confirmBundle(): Promise<{ build?: string }>;
}

let staged: string | null = null;
let checking = false;
let now: (() => Promise<"current" | "applying" | "unreachable">) | null = null;

/**
 * Check for updates, pressed by hand on a development client: take the
 * connected server's interface now (the page reloads into it) rather than at
 * the next app switch. Null when this client does not live-update.
 */
export function liveUpdateNow() {
  return now ? now() : null;
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
      const result = await plugin.stageBundle({ origin: server });
      staged = result.state === "staged" ? result.build : null;
    } catch {
      // Unreachable, or an older server without bundles: try again later.
    } finally {
      checking = false;
    }
  };
  now = async () => {
    const server = origin();
    if (!server) return "unreachable";
    try {
      const result = await plugin.stageBundle({ origin: server });
      if (result.state !== "staged") return "current";
      await plugin.applyBundle({ build: result.build });
      return "applying";
    } catch {
      return "unreachable";
    }
  };
  void check();
  await App.addListener("resume", () => void check());
  await App.addListener("pause", () => {
    if (staged) void plugin.applyBundle({ build: staged }).catch(() => {});
  });
}
