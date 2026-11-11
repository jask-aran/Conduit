import { installedClientKind } from "./installed-client.ts";

/**
 * The interface, the server and an installed client's shell ship separately and can disagree, so each is named
 * separately.
 */
export interface BuildStamp {
  version: string;
  commit: string;
  /** Empty unless this build came from a release. */
  release: string;
  builtAt: string;
  dirty?: boolean;
}

declare const __CONDUIT_BUILD__: BuildStamp;

// Defined by Vite at build time; a test importing this module runs without it.
export const clientBuild: BuildStamp = typeof __CONDUIT_BUILD__ === "undefined"
  ? { version: "dev", commit: "unknown", release: "", builtAt: "" }
  : __CONDUIT_BUILD__;

let devClient: Promise<boolean> | null = null;
/** A `.dev` app identifier, or a browser whose interface is not a release's. */
export const isDevClient = () => devClient ??= (async () => {
  try {
    if (installedClientKind === "desktop") return (await (await import("@tauri-apps/api/app")).getIdentifier()).endsWith(".dev");
    if (installedClientKind === "android") return (await (await import("@capacitor/app")).App.getInfo()).id.endsWith(".dev");
  } catch {
    return false;
  }
  return !clientBuild.release;
})();

export function buildLabel(build: BuildStamp): string {
  const label = build.release || build.version;
  return `${label}${build.release || !label.endsWith(build.commit.slice(0, 7)) ? ` · ${build.commit}` : ""}${build.dirty ? " · modified" : ""}`;
}

/** The installer that was run, not the bundle it carries. */
export async function shellVersion(): Promise<string | null> {
  try {
    if (installedClientKind === "desktop") {
      const { getVersion } = await import("@tauri-apps/api/app");
      return await getVersion();
    }
    if (installedClientKind === "android") {
      const { androidShell } = await import("./installed-client.ts");
      return await androidShell?.version() ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

export interface ServerBuild {
  release: string;
  status: string;
}

export async function serverBuild(fetchHealth: () => Promise<Response>): Promise<ServerBuild | null> {
  try {
    const response = await fetchHealth();
    if (!response.ok) return null;
    const body = await response.json() as { release?: unknown; status?: unknown };
    return {
      release: typeof body.release === "string" && body.release ? body.release : "unknown",
      status: typeof body.status === "string" ? body.status : "",
    };
  } catch {
    return null;
  }
}
